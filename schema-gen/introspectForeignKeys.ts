import { QueryFn } from './connection';
import { matchesLikePattern } from './likePattern';
import { nullableTrim } from './tableGrouping';

export type ForeignKeyAction = 'cascade' | 'set null' | 'set default' | 'no action';

export interface IntrospectedForeignKey {
	tableName: string;
	name: string;
	columns: string[];
	referencedTable: string;
	referencedColumns: string[];
	onDelete: ForeignKeyAction | null;
	onUpdate: ForeignKeyAction | null;
	indexName: string;
	descending: boolean;
}

interface ForeignKeyRow {
	table_name: string;
	constraint_name: string;
	index_name: string;
	index_type: number;
	ref_table: string;
	update_rule: string | null;
	delete_rule: string | null;
	child_column: string | null;
	parent_column: string | null;
	field_position: number;
}

interface ForeignKeyDraft {
	foreignKey: IntrospectedForeignKey;
	segments: { position: number; column: string; referencedColumn: string }[];
}

// RESTRICT é o valor gravado quando a cláusula é omitida e não é sintaxe válida no Firebird 2.5.
const RULE_ACTIONS = new Map<string, ForeignKeyAction | null>([
	['CASCADE', 'cascade'],
	['SET NULL', 'set null'],
	['SET DEFAULT', 'set default'],
	['NO ACTION', 'no action'],
	['RESTRICT', null],
]);

const parseRule = (
	rule: string | null,
	event: string,
	tableName: string,
	constraintName: string,
): ForeignKeyAction | null => {
	const trimmed = nullableTrim(rule);

	if (trimmed === null || !RULE_ACTIONS.has(trimmed)) {
		throw new Error(`Regra ON ${event} desconhecida ("${rule}") na FK ${constraintName} da tabela ${tableName}.`);
	}

	return RULE_ACTIONS.get(trimmed) ?? null;
};

export const introspectForeignKeys = async (
	query: QueryFn,
	excludePatterns: string[] = [],
): Promise<IntrospectedForeignKey[]> => {
	const foreignKeysSql = `
		select trim(fk.rdb$relation_name) table_name,
		       trim(fk.rdb$constraint_name) constraint_name,
		       trim(fk.rdb$index_name) index_name,
		       coalesce(fi.rdb$index_type, 0) index_type,
		       trim(uq.rdb$relation_name) ref_table,
		       trim(rf.rdb$update_rule) update_rule,
		       trim(rf.rdb$delete_rule) delete_rule,
		       trim(cs.rdb$field_name) child_column,
		       trim(ps.rdb$field_name) parent_column,
		       cs.rdb$field_position field_position
		  from rdb$relation_constraints fk
		  join rdb$ref_constraints rf on rf.rdb$constraint_name = fk.rdb$constraint_name
		  join rdb$relation_constraints uq on uq.rdb$constraint_name = rf.rdb$const_name_uq
		  join rdb$indices fi on fi.rdb$index_name = fk.rdb$index_name
		  join rdb$index_segments cs on cs.rdb$index_name = fk.rdb$index_name
		  join rdb$index_segments ps on ps.rdb$index_name = uq.rdb$index_name
		                            and ps.rdb$field_position = cs.rdb$field_position
		  join rdb$relations r on r.rdb$relation_name = fk.rdb$relation_name
		                      and r.rdb$view_blr is null
		                      and coalesce(r.rdb$system_flag, 0) = 0
		 where fk.rdb$constraint_type = 'FOREIGN KEY'
		 order by fk.rdb$relation_name, fk.rdb$constraint_name, cs.rdb$field_position
	`;

	const rows = await query<ForeignKeyRow>(foreignKeysSql);

	const isExcluded = (name: string): boolean => excludePatterns.some((pattern) => matchesLikePattern(name, pattern));
	const drafts = new Map<string, ForeignKeyDraft>();

	for (const row of rows) {
		const tableName = row.table_name.trim();
		const name = row.constraint_name.trim();

		if (isExcluded(tableName) || isExcluded(name)) {
			continue;
		}

		const column = nullableTrim(row.child_column);
		const referencedColumn = nullableTrim(row.parent_column);

		if (column === null || column === '' || referencedColumn === null || referencedColumn === '') {
			throw new Error(`FK ${name} da tabela ${tableName} possui segmento de índice sem nome de coluna.`);
		}

		const key = `${tableName}\u0000${name}`;
		const draft = drafts.get(key) ?? {
			foreignKey: {
				tableName,
				name,
				columns: [],
				referencedTable: row.ref_table.trim(),
				referencedColumns: [],
				onDelete: parseRule(row.delete_rule, 'DELETE', tableName, name),
				onUpdate: parseRule(row.update_rule, 'UPDATE', tableName, name),
				indexName: row.index_name.trim(),
				descending: row.index_type === 1,
			},
			segments: [],
		};

		draft.segments.push({ position: row.field_position, column, referencedColumn });
		drafts.set(key, draft);
	}

	return [...drafts.values()]
		.map(({ foreignKey, segments }) => {
			const ordered = [...segments].sort((a, b) => a.position - b.position);

			return {
				...foreignKey,
				columns: ordered.map((segment) => segment.column),
				referencedColumns: ordered.map((segment) => segment.referencedColumn),
			};
		})
		.sort((a, b) => a.tableName.localeCompare(b.tableName) || a.name.localeCompare(b.name));
};
