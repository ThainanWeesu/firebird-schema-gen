import { PROCEDURE_SOURCE, readChunkedSource, requireCompleteSource, sourceChunkExpression } from './blobText';
import { QueryFn } from './connection';
import { matchesLikePattern } from './likePattern';
import { InlineTypeSource } from './renderTable';
import { nullableTrim } from './tableGrouping';

const PARAMETER_TYPE_INPUT = 0;
const PARAMETER_TYPE_OUTPUT = 1;
const MECHANISM_DOMAIN = 0;
const MECHANISM_TYPE_OF = 1;
const AUTO_FIELD_SOURCE = /^RDB\$\d+$/;

export type ProcedureParameterType =
	| { kind: 'domain'; domainName: string }
	| { kind: 'typeOfDomain'; domainName: string }
	| { kind: 'typeOfColumn'; tableName: string; columnName: string }
	| { kind: 'inline'; source: InlineTypeSource };

export interface IntrospectedProcedureParameter {
	name: string;
	direction: 'input' | 'output';
	type: ProcedureParameterType;
	notNull: boolean;
	collationName: string | null;
	defaultSource: string | null;
}

export interface IntrospectedProcedure {
	name: string;
	inputs: IntrospectedProcedureParameter[];
	outputs: IntrospectedProcedureParameter[];
	source: string | null;
}

interface ProbeRow {
	probe_count: number;
}

interface ProcedureRow {
	procedure_name: string;
	source_chunk: string | null;
}

interface ParameterRow {
	procedure_name: string;
	parameter_name: string;
	parameter_number: number | null;
	parameter_type: number | null;
	field_source: string;
	null_flag: number;
	parameter_mechanism: number;
	type_of_relation: string | null;
	type_of_column: string | null;
	param_collation_id: number | null;
	param_default_source: string | null;
	field_type: number;
	field_sub_type: number | null;
	field_scale: number | null;
	field_precision: number | null;
	field_length: number | null;
	char_len: number | null;
	dimensions: number | null;
	field_collation_id: number | null;
	charset_name: string | null;
	field_collation_name: string | null;
	param_collation_name: string | null;
	field_default_source: string | null;
}

interface NumberedParameter {
	number: number;
	parameter: IntrospectedProcedureParameter;
}

interface ProcedureDraft {
	name: string;
	source: string | null;
	inputs: NumberedParameter[];
	outputs: NumberedParameter[];
}

const PROBE_SQL = `
	select count(*) probe_count
	  from rdb$relation_fields rf
	 where rf.rdb$relation_name = 'RDB$PROCEDURE_PARAMETERS'
	   and rf.rdb$field_name in ('RDB$FIELD_NAME', 'RDB$RELATION_NAME')
`;

const PROCEDURES_SQL = `
	select trim(p.rdb$procedure_name) procedure_name,
	       ${sourceChunkExpression('p.rdb$procedure_source')} source_chunk
	  from rdb$procedures p
	 where coalesce(p.rdb$system_flag, 0) = 0
	 order by p.rdb$procedure_name
`;

const buildParametersSql = (hasTypeOfColumnColumns: boolean): string => {
	const typeOfColumns = hasTypeOfColumnColumns
		? `trim(pp.rdb$relation_name) type_of_relation,
	       trim(pp.rdb$field_name) type_of_column,`
		: `cast(null as varchar(31)) type_of_relation,
	       cast(null as varchar(31)) type_of_column,`;

	return `
	select trim(pp.rdb$procedure_name) procedure_name,
	       trim(pp.rdb$parameter_name) parameter_name,
	       pp.rdb$parameter_number parameter_number,
	       pp.rdb$parameter_type parameter_type,
	       trim(pp.rdb$field_source) field_source,
	       coalesce(pp.rdb$null_flag, 0) null_flag,
	       coalesce(pp.rdb$parameter_mechanism, 0) parameter_mechanism,
	       ${typeOfColumns}
	       pp.rdb$collation_id param_collation_id,
	       ${sourceChunkExpression('pp.rdb$default_source')} param_default_source,
	       f.rdb$field_type field_type,
	       f.rdb$field_sub_type field_sub_type,
	       f.rdb$field_scale field_scale,
	       f.rdb$field_precision field_precision,
	       f.rdb$field_length field_length,
	       f.rdb$character_length char_len,
	       f.rdb$dimensions dimensions,
	       f.rdb$collation_id field_collation_id,
	       trim(cs.rdb$character_set_name) charset_name,
	       trim(cf.rdb$collation_name) field_collation_name,
	       trim(cp.rdb$collation_name) param_collation_name,
	       ${sourceChunkExpression('f.rdb$default_source')} field_default_source
	  from rdb$procedure_parameters pp
	  join rdb$procedures p on p.rdb$procedure_name = pp.rdb$procedure_name
	  join rdb$fields f on f.rdb$field_name = pp.rdb$field_source
	  left join rdb$character_sets cs on cs.rdb$character_set_id = f.rdb$character_set_id
	  left join rdb$collations cf on cf.rdb$character_set_id = f.rdb$character_set_id
	                             and cf.rdb$collation_id = f.rdb$collation_id
	  left join rdb$collations cp on cp.rdb$character_set_id = f.rdb$character_set_id
	                             and cp.rdb$collation_id = pp.rdb$collation_id
	 where coalesce(p.rdb$system_flag, 0) = 0
	 order by pp.rdb$procedure_name, pp.rdb$parameter_type, pp.rdb$parameter_number
`;
};

// rdb$field_name e rdb$relation_name de rdb$procedure_parameters só existem a partir da ODS 11.2;
// selecioná-las em banco mais antigo aborta a query inteira (-206).
const hasTypeOfColumnSupport = async (query: QueryFn): Promise<boolean> => {
	const rows = await query<ProbeRow>(PROBE_SQL);
	const count = rows[0]?.probe_count;

	if (typeof count !== 'number') {
		throw new Error(
			`Sondagem da ODS de rdb$procedure_parameters retornou "${typeof count}" — esperava número (count(*)).`,
		);
	}

	return count === 2;
};

const isExcluded = (name: string, excludePatterns: string[]): boolean =>
	excludePatterns.some((pattern) => matchesLikePattern(name, pattern));

const requireName = (value: string | null | undefined, label: string): string => {
	const name = nullableTrim(value);

	if (name === null || name === '') {
		throw new Error(`Metadado sem nome: ${label}.`);
	}

	return name;
};

const nonBlank = (text: string | null): string | null => (text === null || text.trim() === '' ? null : text);

const toDirection = (parameterType: number | null, label: string): 'input' | 'output' => {
	if (parameterType === PARAMETER_TYPE_INPUT) {
		return 'input';
	}

	if (parameterType === PARAMETER_TYPE_OUTPUT) {
		return 'output';
	}

	throw new Error(`rdb$parameter_type desconhecido em ${label}: ${parameterType}.`);
};

const resolveType = (row: ParameterRow, parameterName: string, label: string): ProcedureParameterType => {
	const fieldSource = requireName(row.field_source, `rdb$field_source de ${label}`);
	const relationName = nullableTrim(row.type_of_relation);
	const columnName = nullableTrim(row.type_of_column);

	if ((relationName === null) !== (columnName === null)) {
		throw new Error(
			`${label} tem só um entre rdb$relation_name (${relationName}) e rdb$field_name (${columnName}) — TYPE OF COLUMN inconsistente.`,
		);
	}

	if (relationName !== null && columnName !== null) {
		return { kind: 'typeOfColumn', tableName: relationName, columnName };
	}

	if (row.parameter_mechanism === MECHANISM_TYPE_OF) {
		if (AUTO_FIELD_SOURCE.test(fieldSource)) {
			throw new Error(
				`${label} usa TYPE OF (rdb$parameter_mechanism=1) mas rdb$field_source é o campo automático ${fieldSource}.`,
			);
		}

		return { kind: 'typeOfDomain', domainName: fieldSource };
	}

	if (row.parameter_mechanism !== MECHANISM_DOMAIN) {
		throw new Error(`rdb$parameter_mechanism desconhecido em ${label}: ${row.parameter_mechanism}.`);
	}

	if (!fieldSource.toUpperCase().startsWith('RDB$')) {
		return { kind: 'domain', domainName: fieldSource };
	}

	return {
		kind: 'inline',
		source: {
			name: parameterName,
			fieldType: row.field_type,
			fieldSubType: row.field_sub_type,
			fieldScale: row.field_scale,
			fieldPrecision: row.field_precision,
			fieldLength: row.field_length,
			characterLength: row.char_len,
			dimensions: row.dimensions,
			charsetName: nullableTrim(row.charset_name),
		},
	};
};

const resolveCollationName = (row: ParameterRow, inline: boolean, label: string): string | null => {
	const collationId = inline ? row.field_collation_id : row.param_collation_id;

	if (collationId === null || collationId === undefined || collationId === 0) {
		return null;
	}

	const collationName = nullableTrim(inline ? row.field_collation_name : row.param_collation_name);

	if (collationName === null || collationName === '') {
		throw new Error(`Collation id ${collationId} de ${label} não encontrada em rdb$collations.`);
	}

	return collationName;
};

const toParameter = (row: ParameterRow, procedureName: string): NumberedParameter => {
	const parameterName = requireName(row.parameter_name, `rdb$parameter_name de ${procedureName}`);
	const label = `${procedureName}.${parameterName}`;
	const direction = toDirection(row.parameter_type, label);

	if (typeof row.parameter_number !== 'number') {
		throw new Error(
			`rdb$parameter_number de ${label} veio como "${typeof row.parameter_number}" — esperava número.`,
		);
	}

	const type = resolveType(row, parameterName, label);
	const inline = type.kind === 'inline';

	const parameterDefault = nonBlank(
		requireCompleteSource(row.param_default_source, `rdb$default_source do parâmetro ${label}`),
	);
	// Em tipo inline o DEFAULT fica na linha rdb$fields do campo automático RDB$nnn, não no parâmetro.
	const fieldDefault = inline
		? nonBlank(requireCompleteSource(row.field_default_source, `rdb$default_source do tipo do parâmetro ${label}`))
		: null;
	const defaultSource = parameterDefault ?? fieldDefault;

	if (direction === 'output' && defaultSource !== null) {
		throw new Error(
			`Parâmetro de saída ${label} tem DEFAULT nos metadados — não suportado pela sintaxe do Firebird 2.5.`,
		);
	}

	return {
		number: row.parameter_number,
		parameter: {
			name: parameterName,
			direction,
			type,
			notNull: row.null_flag === 1,
			collationName: resolveCollationName(row, inline, label),
			defaultSource,
		},
	};
};

const sortByNumber = (parameters: NumberedParameter[]): IntrospectedProcedureParameter[] =>
	[...parameters].sort((a, b) => a.number - b.number).map((entry) => entry.parameter);

export const introspectProcedures = async (
	query: QueryFn,
	excludePatterns: string[] = [],
): Promise<IntrospectedProcedure[]> => {
	const supportsTypeOfColumn = await hasTypeOfColumnSupport(query);
	const procedureRows = await query<ProcedureRow>(PROCEDURES_SQL);

	const drafts = new Map<string, ProcedureDraft>();

	for (const row of procedureRows) {
		const name = requireName(row.procedure_name, 'rdb$procedure_name');

		if (isExcluded(name, excludePatterns)) {
			continue;
		}

		const source = await readChunkedSource(query, PROCEDURE_SOURCE, name, row.source_chunk);
		drafts.set(name, { name, source, inputs: [], outputs: [] });
	}

	if (drafts.size === 0) {
		return [];
	}

	const parameterRows = await query<ParameterRow>(buildParametersSql(supportsTypeOfColumn));

	for (const row of parameterRows) {
		const procedureName = requireName(row.procedure_name, 'rdb$procedure_name de rdb$procedure_parameters');
		const draft = drafts.get(procedureName);

		if (draft === undefined) {
			if (isExcluded(procedureName, excludePatterns)) {
				continue;
			}

			throw new Error(
				`Parâmetro de ${procedureName} sem a procedure na leitura anterior — metadados alterados durante a geração?`,
			);
		}

		const entry = toParameter(row, procedureName);
		(entry.parameter.direction === 'input' ? draft.inputs : draft.outputs).push(entry);
	}

	return [...drafts.values()]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((draft) => ({
			name: draft.name,
			inputs: sortByNumber(draft.inputs),
			outputs: sortByNumber(draft.outputs),
			source: draft.source,
		}));
};
