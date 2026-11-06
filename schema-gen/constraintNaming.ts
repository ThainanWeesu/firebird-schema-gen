import { formatIdentifier } from './identifier';

const SYSTEM_CONSTRAINT_NAME = /^INTEG_\d+$/;

export const IMPLICIT_UNIQUE_INDEX_NAME = /^RDB\$\d+$/;
export const IMPLICIT_FOREIGN_INDEX_NAME = /^RDB\$FOREIGN\d+$/;

export const renderConstraintPrefix = (constraintName: string): string =>
	SYSTEM_CONSTRAINT_NAME.test(constraintName) ? '' : `constraint ${formatIdentifier(constraintName)} `;

export const renderUsingIndex = (
	constraintName: string,
	indexName: string,
	descending: boolean,
	implicitIndexName: RegExp,
): string => {
	const explicitName = indexName !== constraintName && !implicitIndexName.test(indexName);

	if (!explicitName && !descending) {
		return '';
	}

	const targetName = explicitName ? indexName : constraintName;

	return ` using${descending ? ' descending' : ''} index ${formatIdentifier(targetName)}`;
};
