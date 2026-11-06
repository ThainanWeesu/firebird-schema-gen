import { readChunkedSource, sourceChunkExpression, TRIGGER_SOURCE } from './blobText';
import { QueryFn } from './connection';
import { matchesLikePattern } from './likePattern';
import { nullableTrim } from './tableGrouping';

export interface IntrospectedTrigger {
	name: string;
	tableName: string | null;
	type: number;
	active: boolean;
	position: number;
	source: string | null;
}

interface TriggerRow {
	trigger_name: string;
	relation_name: string | null;
	trigger_type: number;
	trigger_sequence: number;
	trigger_inactive: number;
	source_chunk: string | null;
}

const triggersSql = `
	select trim(t.rdb$trigger_name) trigger_name,
	       trim(t.rdb$relation_name) relation_name,
	       t.rdb$trigger_type trigger_type,
	       coalesce(t.rdb$trigger_sequence, 0) trigger_sequence,
	       coalesce(t.rdb$trigger_inactive, 0) trigger_inactive,
	       ${sourceChunkExpression('t.rdb$trigger_source')} source_chunk
	  from rdb$triggers t
	 where coalesce(t.rdb$system_flag, 0) = 0
	 order by 1
`;

const isExcluded = (name: string, excludePatterns: string[]): boolean =>
	excludePatterns.some((pattern) => matchesLikePattern(name, pattern));

const requireName = (value: unknown): string => {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error('rdb$triggers retornou trigger sem rdb$trigger_name.');
	}

	return value.trim();
};

const requireInteger = (value: unknown, column: string, triggerName: string, minimum: number): number => {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
		throw new Error(
			`Trigger ${triggerName}: ${column}=${String(value)} inválido (esperava inteiro >= ${minimum}).`,
		);
	}

	return value;
};

export const introspectTriggers = async (
	query: QueryFn,
	excludePatterns: string[] = [],
): Promise<IntrospectedTrigger[]> => {
	const rows = await query<TriggerRow>(triggersSql);
	const triggers: IntrospectedTrigger[] = [];

	for (const row of rows) {
		const name = requireName(row.trigger_name);
		const tableName = nullableTrim(row.relation_name);

		if (isExcluded(name, excludePatterns) || (tableName !== null && isExcluded(tableName, excludePatterns))) {
			continue;
		}

		const inactive = requireInteger(row.trigger_inactive, 'rdb$trigger_inactive', name, 0);

		if (inactive > 1) {
			throw new Error(`Trigger ${name}: rdb$trigger_inactive=${inactive} desconhecido (esperava 0 ou 1).`);
		}

		const source = await readChunkedSource(query, TRIGGER_SOURCE, name, row.source_chunk);

		triggers.push({
			name,
			tableName,
			type: requireInteger(row.trigger_type, 'rdb$trigger_type', name, 0),
			active: inactive === 0,
			position: requireInteger(row.trigger_sequence, 'rdb$trigger_sequence', name, 0),
			source,
		});
	}

	return triggers.sort((a, b) => a.name.localeCompare(b.name));
};
