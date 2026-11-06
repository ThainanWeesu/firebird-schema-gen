import { formatIdentifier } from './identifier';
import { IntrospectedDomain } from './introspectDomains';
import { renderInlineType } from './renderTable';
import { lowercaseLeadingKeyword, normalizeNewlines } from './sourceText';

const renderSourceClause = (source: string | null, keyword: 'default' | 'check', domainName: string): string => {
	if (source === null) {
		return '';
	}

	const text = normalizeNewlines(source).trim();

	if (text === '') {
		return '';
	}

	if (!new RegExp(`^${keyword}\\b`, 'i').test(text)) {
		throw new Error(
			`Fonte ${keyword} do domain ${domainName} não começa com ${keyword.toUpperCase()} — formato inesperado nos metadados.`,
		);
	}

	return ` ${lowercaseLeadingKeyword(text, keyword)}`;
};

export const renderDomain = (domain: IntrospectedDomain, dbDefaultCharset: string | null): string => {
	const type = renderInlineType(domain, 'dominio', dbDefaultCharset);
	const defaultPart = renderSourceClause(domain.defaultSource, 'default', domain.name);
	const notNullPart = domain.notNull ? ' not null' : '';
	const checkPart = renderSourceClause(domain.validationSource, 'check', domain.name);
	const collatePart = domain.collationName === null ? '' : ` collate ${formatIdentifier(domain.collationName)}`;

	return `create domain ${formatIdentifier(domain.name)} as ${type}${defaultPart}${notNullPart}${checkPart}${collatePart};\n`;
};
