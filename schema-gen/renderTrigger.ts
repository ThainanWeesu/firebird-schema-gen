import { formatIdentifier } from './identifier';
import { IntrospectedTrigger } from './introspectTriggers';
import { lowercaseLeadingKeyword, normalizeNewlines, stripLeadingBlankLines } from './sourceText';
import { DecodedTriggerType, decodeTriggerType } from './triggerType';

// Diferente de procedures e views, o rdb$trigger_source já inclui a palavra AS.
const LEADING_AS = /^\s*as\b/i;

const decodeType = (trigger: IntrospectedTrigger): DecodedTriggerType => {
	try {
		return decodeTriggerType(trigger.type);
	} catch (error) {
		throw new Error(`Trigger ${trigger.name}: ${error instanceof Error ? error.message : String(error)}`);
	}
};

const renderHeader = (trigger: IntrospectedTrigger): string => {
	const decoded = decodeType(trigger);
	const name = formatIdentifier(trigger.name);
	const status = trigger.active ? 'active' : 'inactive';

	if (decoded.scope === 'database') {
		if (trigger.tableName !== null) {
			throw new Error(
				`Trigger ${trigger.name}: rdb$trigger_type=${trigger.type} é de banco de dados mas a trigger está ligada à tabela ${trigger.tableName}.`,
			);
		}

		return `create or alter trigger ${name} ${status} on ${decoded.event} position ${trigger.position}`;
	}

	if (trigger.tableName === null) {
		throw new Error(
			`Trigger ${trigger.name}: rdb$trigger_type=${trigger.type} é de tabela mas a trigger não tem rdb$relation_name.`,
		);
	}

	return `create or alter trigger ${name} for ${formatIdentifier(trigger.tableName)} ${status} ${decoded.timing} ${decoded.events.join(' or ')} position ${trigger.position}`;
};

const renderBody = (source: string): string => {
	const text = normalizeNewlines(source).trimEnd();

	if (LEADING_AS.test(text)) {
		return lowercaseLeadingKeyword(text.trimStart(), 'as');
	}

	return `as\n${stripLeadingBlankLines(text)}`;
};

const renderMissingSource = (trigger: IntrospectedTrigger): string =>
	`-- trigger ${formatIdentifier(trigger.name)}: rdb$trigger_source ausente (trigger criada via BLR).\n-- DDL não gerado: não há código-fonte para reproduzir esta trigger.\n`;

export const renderTrigger = (trigger: IntrospectedTrigger): string => {
	if (trigger.source === null || trigger.source.trim() === '') {
		return renderMissingSource(trigger);
	}

	return `${renderHeader(trigger)}\n${renderBody(trigger.source)}\n;\n`;
};
