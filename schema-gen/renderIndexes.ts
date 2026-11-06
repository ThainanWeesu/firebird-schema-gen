import { formatIdentifier, formatIdentifierList } from './identifier';
import { IntrospectedIndex } from './introspectIndexes';
import { normalizeNewlines } from './sourceText';

const renderComputedExpression = (expression: string): string => {
	const source = normalizeNewlines(expression).trim();

	return source.startsWith('(') && source.endsWith(')') ? source : `(${source})`;
};

const renderIndex = (index: IntrospectedIndex): string => {
	const target =
		index.expression === null
			? `(${formatIdentifierList(index.columns)})`
			: `computed by ${renderComputedExpression(index.expression)}`;
	const unique = index.unique ? 'unique ' : '';
	const descending = index.descending ? 'descending ' : '';
	const name = formatIdentifier(index.name);
	const create = `create ${unique}${descending}index ${name} on ${formatIdentifier(index.tableName)} ${target};`;

	return index.inactive ? `${create}\nalter index ${name} inactive;` : create;
};

export const renderIndexes = (indexes: IntrospectedIndex[]): string => {
	if (indexes.length === 0) {
		return '';
	}

	const statements = [...indexes]
		.sort((a, b) => a.tableName.localeCompare(b.tableName) || a.name.localeCompare(b.name))
		.map(renderIndex);

	return `${statements.join('\n')}\n`;
};
