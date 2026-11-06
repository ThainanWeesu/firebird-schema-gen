export const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');

export const lowercaseLeadingKeyword = (source: string, keyword: string): string =>
	source.replace(new RegExp(`^${keyword}\\b`, 'i'), keyword.toLowerCase());

export const stripLeadingBlankLines = (text: string): string => text.replace(/^(?:[ \t]*\n)+/, '');
