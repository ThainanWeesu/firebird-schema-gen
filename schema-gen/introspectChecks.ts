import { QueryFn } from './connection';
import { matchesLikePattern } from './likePattern';
import { readChunkedSource, sourceChunkExpression, TRIGGER_SOURCE } from './blobText';

export interface IntrospectedCheck {
	tableName: string;
	name: string;
	source: string;
}

interface CheckRow {
	table_name: string;
	constraint_name: string;
	trigger_name: string;
	source_chunk: string | null;
}

export const introspectChecks = async (
	query: QueryFn,
	excludePatterns: string[] = [],
): Promise<IntrospectedCheck[]> => {
	// Cada CHECK tem 2 triggers de sistema (1 = before insert, 3 = before update): o tipo 1 dá uma linha por constraint.
	const checksSql = `
		select trim(rc.rdb$relation_name) table_name,
		       trim(rc.rdb$constraint_name) constraint_name,
		       trim(t.rdb$trigger_name) trigger_name,
		       ${sourceChunkExpression('t.rdb$trigger_source')} source_chunk
		  from rdb$relation_constraints rc
		  join rdb$relations r on r.rdb$relation_name = rc.rdb$relation_name
		                      and r.rdb$view_blr is null
		                      and coalesce(r.rdb$system_flag, 0) = 0
		  join rdb$check_constraints cc on cc.rdb$constraint_name = rc.rdb$constraint_name
		  join rdb$triggers t on t.rdb$trigger_name = cc.rdb$trigger_name
		 where rc.rdb$constraint_type = 'CHECK'
		   and t.rdb$trigger_type = 1
		   and t.rdb$system_flag = 3
		 order by rc.rdb$relation_name, rc.rdb$constraint_name
	`;

	const rows = await query<CheckRow>(checksSql);

	const isExcluded = (name: string): boolean => excludePatterns.some((pattern) => matchesLikePattern(name, pattern));
	const checks: IntrospectedCheck[] = [];

	for (const row of rows) {
		const tableName = row.table_name.trim();
		const name = row.constraint_name.trim();

		if (isExcluded(tableName) || isExcluded(name)) {
			continue;
		}

		const source = await readChunkedSource(query, TRIGGER_SOURCE, row.trigger_name.trim(), row.source_chunk);

		if (source === null) {
			throw new Error(`CHECK ${name} da tabela ${tableName} não possui fonte (rdb$trigger_source vazio).`);
		}

		checks.push({ tableName, name, source });
	}

	return checks.sort((a, b) => a.tableName.localeCompare(b.tableName) || a.name.localeCompare(b.name));
};
