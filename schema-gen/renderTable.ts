import { IntrospectedColumn, IntrospectedTable } from './introspectTables';

// Códigos de rdb$fields.rdb$field_type (Firebird 2.5).
const FIELD_TYPE = {
	SMALLINT: 7,
	INTEGER: 8,
	FLOAT: 10,
	DATE: 12,
	TIME: 13,
	CHAR: 14,
	BIGINT: 16,
	DOUBLE: 27,
	TIMESTAMP: 35,
	VARCHAR: 37,
	BLOB: 261,
} as const;

const INTEGER_TYPE_NAMES: Record<number, string> = {
	[FIELD_TYPE.SMALLINT]: 'smallint',
	[FIELD_TYPE.INTEGER]: 'integer',
	[FIELD_TYPE.BIGINT]: 'bigint',
};

const DEFAULT_PRECISION: Record<number, number> = {
	[FIELD_TYPE.SMALLINT]: 4,
	[FIELD_TYPE.INTEGER]: 9,
	[FIELD_TYPE.BIGINT]: 18,
};

const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');

// Rebaixa somente a palavra-chave DEFAULT, preservando o literal
// (DEFAULT 'S' não pode virar 's').
const lowercaseDefaultKeyword = (source: string): string => source.replace(/^default\b/i, 'default');

export type InlineTypeSource = Pick<
	IntrospectedColumn,
	'name' | 'fieldType' | 'fieldSubType' | 'fieldScale' | 'fieldPrecision' | 'fieldLength' | 'characterLength' | 'dimensions' | 'charsetName'
>;

export const renderInlineType = (column: InlineTypeSource, tableName: string, dbDefaultCharset: string | null): string => {
	const { fieldType } = column;
	const scale = -(column.fieldScale ?? 0);
	const subType = column.fieldSubType ?? 0;

	if (column.dimensions !== null && column.dimensions > 0) {
		throw new Error(
			`${tableName}.${column.name} é uma coluna ARRAY (rdb$dimensions=${column.dimensions}) — não suportado pelo gerador.`,
		);
	}

	if (fieldType in INTEGER_TYPE_NAMES) {
		if (scale > 0 || subType === 1 || subType === 2) {
			const base = subType === 2 ? 'decimal' : 'numeric';
			const precision = column.fieldPrecision || DEFAULT_PRECISION[fieldType];
			return `${base}(${precision},${scale})`;
		}

		return INTEGER_TYPE_NAMES[fieldType];
	}

	switch (fieldType) {
		case FIELD_TYPE.FLOAT:
			return 'float';
		case FIELD_TYPE.DOUBLE: {
			if (scale > 0) {
				console.warn(`Aviso: ${tableName}.${column.name} é DOUBLE com scale ${scale} (numeric de dialeto 1?) — emitindo numeric(15,${scale}).`);
				return `numeric(15,${scale})`;
			}
			return 'double precision';
		}
		case FIELD_TYPE.DATE:
			return 'date';
		case FIELD_TYPE.TIME:
			return 'time';
		case FIELD_TYPE.TIMESTAMP:
			return 'timestamp';
		case FIELD_TYPE.CHAR:
		case FIELD_TYPE.VARCHAR: {
			const length = column.characterLength ?? column.fieldLength;

			if (!length) {
				throw new Error(`${tableName}.${column.name} é CHAR/VARCHAR sem comprimento nos metadados (rdb$character_length e rdb$field_length nulos).`);
			}

			const base = fieldType === FIELD_TYPE.CHAR ? 'char' : 'varchar';
			return `${base}(${length})${charsetSuffix(column, dbDefaultCharset)}`;
		}
		case FIELD_TYPE.BLOB:
			return `blob sub_type ${subType}${subType === 1 ? charsetSuffix(column, dbDefaultCharset) : ''}`;
		default:
			throw new Error(
				`Tipo de campo desconhecido em ${tableName}.${column.name}: rdb$field_type=${fieldType} (sub_type=${subType}). Adicione o mapeamento em renderTable.ts.`,
			);
	}
};

const charsetSuffix = (column: InlineTypeSource, dbDefaultCharset: string | null): string => {
	// Banco sem DEFAULT CHARACTER SET declarado equivale a NONE.
	const effectiveDefault = dbDefaultCharset ?? 'NONE';

	if (!column.charsetName || column.charsetName === effectiveDefault) {
		return '';
	}

	return ` character set ${column.charsetName.toLowerCase()}`;
};

const renderColumn = (column: IntrospectedColumn, tableName: string, dbDefaultCharset: string | null): string => {
	const name = column.name.toLowerCase();

	if (column.computedSource !== null) {
		return `\t${name} computed by ${normalizeNewlines(column.computedSource).trim()}`;
	}

	const type = column.domainName?.toLowerCase() ?? renderInlineType(column, tableName, dbDefaultCharset);
	const defaultPart = column.defaultSource ? ` ${lowercaseDefaultKeyword(normalizeNewlines(column.defaultSource).trim())}` : '';
	const notNullPart = column.notNull ? ' not null' : '';

	return `\t${name} ${type}${defaultPart}${notNullPart}`;
};

export const renderTable = (table: IntrospectedTable, dbDefaultCharset: string | null): string => {
	const lines = [...table.columns]
		.sort((a, b) => a.position - b.position)
		.map((column) => renderColumn(column, table.name, dbDefaultCharset));

	if (table.primaryKey) {
		const pkColumns = table.primaryKey.columns.map((columnName) => columnName.toLowerCase()).join(',');
		lines.push(`\tconstraint ${table.primaryKey.constraintName.toLowerCase()} primary key (${pkColumns})`);
	}

	return `create table ${table.name.toLowerCase()} (\n${lines.join(',\n')}\n);\n`;
};
