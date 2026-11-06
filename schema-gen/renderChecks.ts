import { renderConstraintPrefix } from './constraintNaming';
import { formatIdentifier } from './identifier';
import { IntrospectedCheck } from './introspectChecks';
import { lowercaseLeadingKeyword, normalizeNewlines } from './sourceText';

const renderCheck = (check: IntrospectedCheck): string => {
	const source = normalizeNewlines(check.source).trim();

	if (!/^check\b/i.test(source)) {
		throw new Error(`Fonte do CHECK ${check.name} da tabela ${check.tableName} não começa com CHECK.`);
	}

	return `alter table ${formatIdentifier(check.tableName)} add ${renderConstraintPrefix(check.name)}${lowercaseLeadingKeyword(source, 'check')};`;
};

export const renderChecks = (checks: IntrospectedCheck[]): string => {
	if (checks.length === 0) {
		return '';
	}

	const lines = [...checks]
		.sort((a, b) => a.tableName.localeCompare(b.tableName) || a.name.localeCompare(b.name))
		.map(renderCheck);

	return `${lines.join('\n')}\n`;
};
