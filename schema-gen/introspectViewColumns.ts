type QueryFn = <R>(sql: string, params?: unknown[]) => Promise<R[]>;

interface ColumnRow {
	relation_name: string;
	field_name: string;
}

export const introspectViewColumns = async (query: QueryFn): Promise<Map<string, string[]>> => {
	const sql = `
		select trim(rf.rdb$relation_name) relation_name,
		       trim(rf.rdb$field_name) field_name
		  from rdb$relation_fields rf
		  join rdb$relations rel on rel.rdb$relation_name = rf.rdb$relation_name
		 where rel.rdb$view_source is not null
		   and coalesce(rel.rdb$system_flag, 0) = 0
		 order by rf.rdb$relation_name, rf.rdb$field_position
	`;

	const rows = await query<ColumnRow>(sql);
	const map = new Map<string, string[]>();

	for (const row of rows) {
		const name = row.relation_name.trim();
		const columns = map.get(name) ?? [];
		columns.push(row.field_name.trim());
		map.set(name, columns);
	}

	return map;
};
