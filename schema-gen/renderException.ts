import { formatIdentifier } from './identifier';
import { IntrospectedException } from './introspectExceptions';
import { normalizeNewlines } from './sourceText';

export const renderException = (exception: IntrospectedException): string => {
	const message = normalizeNewlines(exception.message).replace(/'/g, "''");

	return `create exception ${formatIdentifier(exception.name)} '${message}';\n`;
};
