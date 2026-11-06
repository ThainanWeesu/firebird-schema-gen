import { QueryFn } from './connection';
import { matchesLikePattern } from './likePattern';

// rdb$default_source e rdb$computed_source são BLOBs; lidos como VARCHAR via
// cast(substring(...)) pelo mesmo motivo das views (caminho de BLOB do driver
// fork trava). Fontes dessas colunas são curtas — se alguma atingir o limite,
// o erro é alto e explícito.
const SOURCE_LIMIT = 8000;

export interface IntrospectedColumn {
	name: string;
	position: number;
	/** Nome do domain de usuário quando a coluna usa um (senão, tipo inline). */
	domainName: string | null;
	fieldType: number;
	fieldSubType: number | null;
	fieldScale: number | null;
	fieldPrecision: number | null;
	fieldLength: number | null;
	characterLength: number | null;
	/** Não-nulo quando a coluna é ARRAY (não suportado pelo gerador). */
	dimensions: number | null;
	charsetName: string | null;
	notNull: boolean;
	/** Texto verbatim do Firebird, já inclui a palavra DEFAULT (ex.: "DEFAULT 'S'"). */
	defaultSource: string | null;
	/** Expressão de coluna computada, verbatim (normalmente já entre parênteses). */
	computedSource: string | null;
}

export interface IntrospectedTable {
	name: string;
	columns: IntrospectedColumn[];
	primaryKey: { constraintName: string; columns: string[] } | null;
}

interface ColumnRow {
	table_name: string;
	field_name: string;
	field_position: number;
	field_source: string;
	null_flag: number | null;
	default_source: string | null;
	field_type: number;
	field_sub_type: number | null;
	field_scale: number | null;
	field_precision: number | null;
	field_length: number | null;
	char_len: number | null;
	dimensions: number | null;
	computed_source: string | null;
	charset_name: string | null;
}

interface PrimaryKeyRow {
	table_name: string;
	constraint_name: string;
	field_name: string;
}

export const introspectTables = async (query: QueryFn, excludePatterns: string[] = []): Promise<IntrospectedTable[]> => {
	const columnsSql = `
		select trim(rf.rdb$relation_name) table_name,
		       trim(rf.rdb$field_name) field_name,
		       rf.rdb$field_position field_position,
		       trim(rf.rdb$field_source) field_source,
		       rf.rdb$null_flag null_flag,
		       cast(substring(rf.rdb$default_source from 1 for ${SOURCE_LIMIT}) as varchar(${SOURCE_LIMIT})) default_source,
		       f.rdb$field_type field_type,
		       f.rdb$field_sub_type field_sub_type,
		       f.rdb$field_scale field_scale,
		       f.rdb$field_precision field_precision,
		       f.rdb$field_length field_length,
		       f.rdb$character_length char_len,
		       f.rdb$dimensions dimensions,
		       cast(substring(f.rdb$computed_source from 1 for ${SOURCE_LIMIT}) as varchar(${SOURCE_LIMIT})) computed_source,
		       trim(cs.rdb$character_set_name) charset_name
		  from rdb$relation_fields rf
		  join rdb$relations rel on rel.rdb$relation_name = rf.rdb$relation_name
		  join rdb$fields f on f.rdb$field_name = rf.rdb$field_source
		  left join rdb$character_sets cs on cs.rdb$character_set_id = f.rdb$character_set_id
		 where rel.rdb$view_blr is null
		   and coalesce(rel.rdb$system_flag, 0) = 0
		   and coalesce(rel.rdb$relation_type, 0) = 0
		 order by rf.rdb$relation_name, rf.rdb$field_position
	`;

	const primaryKeysSql = `
		select trim(rc.rdb$relation_name) table_name,
		       trim(rc.rdb$constraint_name) constraint_name,
		       trim(iseg.rdb$field_name) field_name
		  from rdb$relation_constraints rc
		  join rdb$index_segments iseg on iseg.rdb$index_name = rc.rdb$index_name
		 where rc.rdb$constraint_type = 'PRIMARY KEY'
		 order by rc.rdb$relation_name, iseg.rdb$field_position
	`;

	// Sequencial de propósito: uma única transação read-only compartilhada.
	const columnRows = await query<ColumnRow>(columnsSql);
	const pkRows = await query<PrimaryKeyRow>(primaryKeysSql);

	const primaryKeys = new Map<string, { constraintName: string; columns: string[] }>();

	for (const row of pkRows) {
		const tableName = row.table_name.trim();
		const pk = primaryKeys.get(tableName) ?? { constraintName: row.constraint_name.trim(), columns: [] };
		pk.columns.push(row.field_name.trim());
		primaryKeys.set(tableName, pk);
	}

	const tables = new Map<string, IntrospectedTable>();

	for (const row of columnRows) {
		const tableName = row.table_name.trim();

		if (excludePatterns.some((pattern) => matchesLikePattern(tableName, pattern))) {
			continue;
		}

		const defaultSource = assertShortSource(row.default_source, tableName, row.field_name, 'default');
		const computedSource = assertShortSource(row.computed_source, tableName, row.field_name, 'computed');
		const fieldSource = row.field_source.trim();

		const table = tables.get(tableName) ?? { name: tableName, columns: [], primaryKey: primaryKeys.get(tableName) ?? null };

		table.columns.push({
			name: row.field_name.trim(),
			position: row.field_position,
			domainName: fieldSource.toUpperCase().startsWith('RDB$') ? null : fieldSource,
			fieldType: row.field_type,
			fieldSubType: row.field_sub_type,
			fieldScale: row.field_scale,
			fieldPrecision: row.field_precision,
			fieldLength: row.field_length,
			characterLength: row.char_len,
			dimensions: row.dimensions,
			charsetName: row.charset_name?.trim() ?? null,
			notNull: row.null_flag === 1,
			defaultSource,
			computedSource,
		});

		tables.set(tableName, table);
	}

	return [...tables.values()].sort((a, b) => a.name.localeCompare(b.name));
};

const assertShortSource = (
	source: string | null,
	tableName: string,
	fieldName: string,
	kind: string,
): string | null => {
	if (source === null || source === undefined) {
		return null;
	}

	if (source.length >= SOURCE_LIMIT) {
		throw new Error(
			`Fonte ${kind} de ${tableName}.${fieldName.trim()} atingiu ${SOURCE_LIMIT} caracteres — precisa de leitura em chunks.`,
		);
	}

	return source;
};

export const getDatabaseDefaultCharset = async (query: QueryFn): Promise<string | null> => {
	const rows = await query<{ charset_name: string | null }>(
		'select trim(rdb$character_set_name) charset_name from rdb$database',
	);

	return rows[0]?.charset_name?.trim() ?? null;
};
