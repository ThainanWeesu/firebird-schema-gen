import { formatIdentifier } from './identifier';
import { IntrospectedProcedure, IntrospectedProcedureParameter, ProcedureParameterType } from './introspectProcedures';
import { renderInlineType } from './renderTable';
import { lowercaseLeadingKeyword, normalizeNewlines, stripLeadingBlankLines } from './sourceText';

const DEFAULT_CLAUSE = /^(?:default\b|=)/i;

const renderParameterType = (
	type: ProcedureParameterType,
	procedureName: string,
	dbDefaultCharset: string | null,
): string => {
	switch (type.kind) {
		case 'domain':
			return formatIdentifier(type.domainName);
		case 'typeOfDomain':
			return `type of ${formatIdentifier(type.domainName)}`;
		case 'typeOfColumn':
			return `type of column ${formatIdentifier(type.tableName)}.${formatIdentifier(type.columnName)}`;
		case 'inline':
			return renderInlineType(type.source, procedureName, dbDefaultCharset);
	}
};

const renderDefault = (defaultSource: string | null, procedureName: string, parameterName: string): string => {
	if (defaultSource === null || defaultSource === '') {
		return '';
	}

	const text = normalizeNewlines(defaultSource).trim();

	if (!DEFAULT_CLAUSE.test(text)) {
		throw new Error(
			`DEFAULT de ${procedureName}.${parameterName} não começa com DEFAULT nem "=": ${JSON.stringify(text)}.`,
		);
	}

	return ` ${lowercaseLeadingKeyword(text, 'default')}`;
};

const renderParameter = (
	parameter: IntrospectedProcedureParameter,
	procedureName: string,
	dbDefaultCharset: string | null,
): string => {
	const type = renderParameterType(parameter.type, procedureName, dbDefaultCharset);
	const notNullPart = parameter.notNull ? ' not null' : '';
	const collatePart = parameter.collationName ? ` collate ${formatIdentifier(parameter.collationName)}` : '';
	const defaultPart = renderDefault(parameter.defaultSource, procedureName, parameter.name);

	return `\t${formatIdentifier(parameter.name)} ${type}${notNullPart}${collatePart}${defaultPart}`;
};

const renderParameterList = (
	parameters: IntrospectedProcedureParameter[],
	procedureName: string,
	dbDefaultCharset: string | null,
): string => parameters.map((parameter) => renderParameter(parameter, procedureName, dbDefaultCharset)).join(',\n');

const renderBody = (source: string, procedureName: string): string => {
	const body = stripLeadingBlankLines(normalizeNewlines(source)).trimEnd();

	if (body === '') {
		throw new Error(`Fonte da procedure ${procedureName} é vazia.`);
	}

	return body;
};

export const renderProcedure = (procedure: IntrospectedProcedure, dbDefaultCharset: string | null): string => {
	const name = formatIdentifier(procedure.name);

	if (procedure.source === null) {
		return `-- procedure ${name}: sem fonte em rdb$procedure_source (criada via BLR).\n-- DDL não gerado.\n`;
	}

	const inputList =
		procedure.inputs.length > 0
			? ` (\n${renderParameterList(procedure.inputs, procedure.name, dbDefaultCharset)}\n)`
			: '';

	const lines = [`create or alter procedure ${name}${inputList}`];

	if (procedure.outputs.length > 0) {
		lines.push(`returns (\n${renderParameterList(procedure.outputs, procedure.name, dbDefaultCharset)}\n)`);
	}

	lines.push('as', renderBody(procedure.source, procedure.name));

	return `${lines.join('\n')}\n;\n`;
};
