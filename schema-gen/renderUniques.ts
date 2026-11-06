import { IMPLICIT_UNIQUE_INDEX_NAME, renderConstraintPrefix, renderUsingIndex } from './constraintNaming';
import { formatIdentifier, formatIdentifierList } from './identifier';
import { IntrospectedUnique } from './introspectUniques';

const renderUnique = (unique: IntrospectedUnique): string => {
	const prefix = renderConstraintPrefix(unique.name);
	const using = renderUsingIndex(unique.name, unique.indexName, unique.descending, IMPLICIT_UNIQUE_INDEX_NAME);

	return `alter table ${formatIdentifier(unique.tableName)} add ${prefix}unique (${formatIdentifierList(unique.columns)})${using};`;
};

export const renderUniques = (uniques: IntrospectedUnique[]): string => {
	if (uniques.length === 0) {
		return '';
	}

	const lines = [...uniques]
		.sort((a, b) => a.tableName.localeCompare(b.tableName) || a.name.localeCompare(b.name))
		.map(renderUnique);

	return `${lines.join('\n')}\n`;
};
