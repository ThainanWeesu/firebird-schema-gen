export type TriggerDmlEvent = 'insert' | 'update' | 'delete';

export type DatabaseTriggerEvent =
	'connect' | 'disconnect' | 'transaction start' | 'transaction commit' | 'transaction rollback';

export type DecodedTriggerType =
	| { scope: 'table'; timing: 'before' | 'after'; events: TriggerDmlEvent[] }
	| { scope: 'database'; event: DatabaseTriggerEvent };

const DATABASE_TRIGGER_BASE = 8192;
const DML_SLOT_COUNT = 3;
const DML_SLOT_MASK = 3;

const DATABASE_TRIGGER_EVENTS: DatabaseTriggerEvent[] = [
	'connect',
	'disconnect',
	'transaction start',
	'transaction commit',
	'transaction rollback',
];

const DML_EVENT_BY_CODE: Record<number, TriggerDmlEvent> = {
	1: 'insert',
	2: 'update',
	3: 'delete',
};

const invalidType = (type: number, reason: string): Error => new Error(`rdb$trigger_type=${type} inválido: ${reason}.`);

export const decodeTriggerType = (type: number): DecodedTriggerType => {
	if (!Number.isInteger(type) || type < 0) {
		throw invalidType(type, 'esperava inteiro não negativo');
	}

	if (type >= DATABASE_TRIGGER_BASE) {
		const event: DatabaseTriggerEvent | undefined = DATABASE_TRIGGER_EVENTS[type - DATABASE_TRIGGER_BASE];

		if (event === undefined) {
			throw invalidType(type, 'evento de trigger de banco de dados desconhecido');
		}

		return { scope: 'database', event };
	}

	const encoded = type + 1;

	if (encoded >> (2 * DML_SLOT_COUNT + 1) !== 0) {
		throw invalidType(type, 'bits acima do terceiro evento DML');
	}

	const events: TriggerDmlEvent[] = [];
	let ended = false;

	for (let slot = 0; slot < DML_SLOT_COUNT; slot += 1) {
		const code = (encoded >> (2 * slot + 1)) & DML_SLOT_MASK;

		if (code === 0) {
			ended = true;
			continue;
		}

		if (ended) {
			throw invalidType(type, 'evento DML após slot vazio');
		}

		const event = DML_EVENT_BY_CODE[code];

		if (events.includes(event)) {
			throw invalidType(type, `evento ${event} repetido`);
		}

		events.push(event);
	}

	if (events.length === 0) {
		throw invalidType(type, 'nenhum evento DML no primeiro slot');
	}

	return { scope: 'table', timing: (encoded & 1) === 1 ? 'after' : 'before', events };
};
