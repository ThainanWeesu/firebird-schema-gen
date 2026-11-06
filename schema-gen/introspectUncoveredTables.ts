import { QueryFn } from './connection';
import { matchesLikePattern } from './likePattern';

export interface UncoveredTable {
	name: string;
	kind: string;
}

interface UncoveredTableRow {
	table_name: string;
	relation_type: number;
}

const RELATION_TYPE_KINDS: Record<number, string> = {
	2: 'externa',
	4: 'temporária global (preserve rows)',
	5: 'temporária global (delete rows)',
};

export const introspectUncoveredTables = async (
	query: QueryFn,
	excludePatterns: string[] = [],
): Promise<UncoveredTable[]> => {
	const sql = `
		select trim(rel.rdb$relation_name) table_name,
		       rel.rdb$relation_type relation_type
		  from rdb$relations rel
		 where rel.rdb$view_blr is null
		   and coalesce(rel.rdb$system_flag, 0) = 0
		   and rel.rdb$relation_type in (2, 4, 5)
		 order by 1
	`;

	const rows = await query<UncoveredTableRow>(sql);

	return rows
		.filter((row) => !excludePatterns.some((pattern) => matchesLikePattern(row.table_name, pattern)))
		.map((row) => ({
			name: row.table_name.trim(),
			kind: RELATION_TYPE_KINDS[row.relation_type] ?? `tipo ${row.relation_type}`,
		}));
};
