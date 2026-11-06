import { IMPLICIT_FOREIGN_INDEX_NAME, renderConstraintPrefix, renderUsingIndex } from './constraintNaming';
import { formatIdentifier, formatIdentifierList } from './identifier';
import { IntrospectedForeignKey } from './introspectForeignKeys';

const renderForeignKey = (foreignKey: IntrospectedForeignKey): string => {
	const prefix = renderConstraintPrefix(foreignKey.name);
	const onDelete = foreignKey.onDelete === null ? '' : ` on delete ${foreignKey.onDelete}`;
	const onUpdate = foreignKey.onUpdate === null ? '' : ` on update ${foreignKey.onUpdate}`;
	const using = renderUsingIndex(
		foreignKey.name,
		foreignKey.indexName,
		foreignKey.descending,
		IMPLICIT_FOREIGN_INDEX_NAME,
	);
	const columns = formatIdentifierList(foreignKey.columns);
	const referencedColumns = formatIdentifierList(foreignKey.referencedColumns);

	return `alter table ${formatIdentifier(foreignKey.tableName)} add ${prefix}foreign key (${columns}) references ${formatIdentifier(foreignKey.referencedTable)} (${referencedColumns})${onDelete}${onUpdate}${using};`;
};

export const renderForeignKeys = (foreignKeys: IntrospectedForeignKey[]): string => {
	if (foreignKeys.length === 0) {
		return '';
	}

	const lines = [...foreignKeys]
		.sort((a, b) => a.tableName.localeCompare(b.tableName) || a.name.localeCompare(b.name))
		.map(renderForeignKey);

	return `${lines.join('\n')}\n`;
};
