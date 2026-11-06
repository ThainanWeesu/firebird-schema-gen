const PLAIN_IDENTIFIER = /^[A-Z][A-Z0-9_$]*$/;

export const formatIdentifier = (name: string): string =>
	PLAIN_IDENTIFIER.test(name) ? name.toLowerCase() : `"${name.replace(/"/g, '""')}"`;

export const formatIdentifierList = (names: string[]): string => names.map(formatIdentifier).join(', ');
