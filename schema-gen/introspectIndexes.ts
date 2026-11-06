import { INDEX_EXPRESSION_SOURCE, readChunkedSource, sourceChunkExpression } from './blobText';
import { QueryFn } from './connection';
import { matchesLikePattern } from './likePattern';
import { nullableTrim } from './tableGrouping';

export interface IntrospectedIndex {
	tableName: string;
	name: string;
	unique: boolean;
	descending: boolean;
	inactive: boolean;
	columns: string[];
	expression: string | null;
}

interface IndexRow {
	index_name: string;
	table_name: string;
	unique_flag: number;
	index_type: number;
	index_inactive: number;
	expression_chunk: string | null;
	field_name: string | null;
	field_position: number | null;
}

interface IndexDraft {
	index: Omit<IntrospectedIndex, 'columns' | 'expression'>;
	expressionChunk: string | null;
	segments: { position: number; name: string }[];
}

export const introspectIndexes = async (
	query: QueryFn,
	excludePatterns: string[] = [],
): Promise<IntrospectedIndex[]> => {
	// A primeira parte da expressão se repete em cada linha de segmento do índice.
	const indexesSql = `
		select trim(i.rdb$index_name) index_name,
		       trim(i.rdb$relation_name) table_name,
		       coalesce(i.rdb$unique_flag, 0) unique_flag,
		       coalesce(i.rdb$index_type, 0) index_type,
		       coalesce(i.rdb$index_inactive, 0) index_inactive,
		       ${sourceChunkExpression('i.rdb$expression_source')} expression_chunk,
		       trim(s.rdb$field_name) field_name,
		       s.rdb$field_position field_position
		  from rdb$indices i
		  join rdb$relations r on r.rdb$relation_name = i.rdb$relation_name
		  left join rdb$index_segments s on s.rdb$index_name = i.rdb$index_name
		 where r.rdb$view_blr is null
		   and coalesce(r.rdb$system_flag, 0) = 0
		   and not exists (select 1
		                     from rdb$relation_constraints rc
		                    where rc.rdb$index_name = i.rdb$index_name)
		 order by i.rdb$relation_name, i.rdb$index_name, s.rdb$field_position
	`;

	const rows = await query<IndexRow>(indexesSql);

	const isExcluded = (name: string): boolean => excludePatterns.some((pattern) => matchesLikePattern(name, pattern));
	const drafts = new Map<string, IndexDraft>();

	for (const row of rows) {
		const tableName = row.table_name.trim();
		const name = row.index_name.trim();

		if (isExcluded(tableName) || isExcluded(name)) {
			continue;
		}

		const key = `${tableName}\u0000${name}`;
		const draft = drafts.get(key) ?? {
			index: {
				tableName,
				name,
				unique: row.unique_flag === 1,
				descending: row.index_type === 1,
				inactive: row.index_inactive === 1,
			},
			expressionChunk: row.expression_chunk,
			segments: [],
		};

		const fieldName = nullableTrim(row.field_name);

		if (fieldName !== null && fieldName !== '' && row.field_position !== null) {
			draft.segments.push({ position: row.field_position, name: fieldName });
		}

		drafts.set(key, draft);
	}

	const ordered = [...drafts.values()].sort(
		(a, b) => a.index.tableName.localeCompare(b.index.tableName) || a.index.name.localeCompare(b.index.name),
	);
	const indexes: IntrospectedIndex[] = [];

	for (const { index, expressionChunk, segments } of ordered) {
		const expression = await readChunkedSource(query, INDEX_EXPRESSION_SOURCE, index.name, expressionChunk);

		if (expression === null && segments.length === 0) {
			throw new Error(`Índice ${index.name} da tabela ${index.tableName} não possui colunas nem expressão.`);
		}

		indexes.push({
			...index,
			columns:
				expression === null
					? [...segments].sort((a, b) => a.position - b.position).map((segment) => segment.name)
					: [],
			expression,
		});
	}

	return indexes;
};
