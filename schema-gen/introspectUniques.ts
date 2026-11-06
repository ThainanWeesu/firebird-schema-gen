import { QueryFn } from './connection';
import { matchesLikePattern } from './likePattern';
import { nullableTrim } from './tableGrouping';

export interface IntrospectedUnique {
	tableName: string;
	name: string;
	columns: string[];
	indexName: string;
	descending: boolean;
}

interface UniqueRow {
	table_name: string;
	constraint_name: string;
	index_name: string;
	index_type: number;
	field_name: string | null;
	field_position: number;
}

interface UniqueDraft {
	unique: IntrospectedUnique;
	segments: { position: number; name: string }[];
}

export const introspectUniques = async (
	query: QueryFn,
	excludePatterns: string[] = [],
): Promise<IntrospectedUnique[]> => {
	const uniquesSql = `
		select trim(rc.rdb$relation_name) table_name,
		       trim(rc.rdb$constraint_name) constraint_name,
		       trim(rc.rdb$index_name) index_name,
		       coalesce(i.rdb$index_type, 0) index_type,
		       trim(s.rdb$field_name) field_name,
		       s.rdb$field_position field_position
		  from rdb$relation_constraints rc
		  join rdb$relations r on r.rdb$relation_name = rc.rdb$relation_name
		                      and r.rdb$view_blr is null
		                      and coalesce(r.rdb$system_flag, 0) = 0
		  join rdb$indices i on i.rdb$index_name = rc.rdb$index_name
		  join rdb$index_segments s on s.rdb$index_name = i.rdb$index_name
		 where rc.rdb$constraint_type = 'UNIQUE'
		 order by rc.rdb$relation_name, rc.rdb$constraint_name, s.rdb$field_position
	`;

	const rows = await query<UniqueRow>(uniquesSql);

	const isExcluded = (name: string): boolean => excludePatterns.some((pattern) => matchesLikePattern(name, pattern));
	const drafts = new Map<string, UniqueDraft>();

	for (const row of rows) {
		const tableName = row.table_name.trim();
		const name = row.constraint_name.trim();

		if (isExcluded(tableName) || isExcluded(name)) {
			continue;
		}

		const fieldName = nullableTrim(row.field_name);

		if (fieldName === null || fieldName === '') {
			throw new Error(
				`Constraint UNIQUE ${name} da tabela ${tableName} possui segmento de índice sem nome de coluna.`,
			);
		}

		const key = `${tableName}\u0000${name}`;
		const draft = drafts.get(key) ?? {
			unique: {
				tableName,
				name,
				columns: [],
				indexName: row.index_name.trim(),
				descending: row.index_type === 1,
			},
			segments: [],
		};

		draft.segments.push({ position: row.field_position, name: fieldName });
		drafts.set(key, draft);
	}

	return [...drafts.values()]
		.map(({ unique, segments }) => ({
			...unique,
			columns: [...segments].sort((a, b) => a.position - b.position).map((segment) => segment.name),
		}))
		.sort((a, b) => a.tableName.localeCompare(b.tableName) || a.name.localeCompare(b.name));
};
