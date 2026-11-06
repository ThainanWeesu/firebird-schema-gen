export const groupByTable = <T extends { tableName: string }>(items: T[]): Map<string, T[]> => {
	const groups = new Map<string, T[]>();

	for (const item of items) {
		const group = groups.get(item.tableName) ?? [];
		group.push(item);
		groups.set(item.tableName, group);
	}

	return groups;
};

export const nullableTrim = (value: string | null | undefined): string | null =>
	value === null || value === undefined ? null : value.trim();
