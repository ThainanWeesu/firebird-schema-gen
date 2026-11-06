import { QueryFn } from './connection';

export const SOURCE_CHUNK_SIZE = 8000;

const MAX_CHUNKS = 16;
const REPLACEMENT_CHARACTER = '�';

export interface ChunkedSourceLocation {
	table: string;
	keyColumn: string;
	blobColumn: string;
}

export const TRIGGER_SOURCE: ChunkedSourceLocation = {
	table: 'rdb$triggers',
	keyColumn: 'rdb$trigger_name',
	blobColumn: 'rdb$trigger_source',
};

export const PROCEDURE_SOURCE: ChunkedSourceLocation = {
	table: 'rdb$procedures',
	keyColumn: 'rdb$procedure_name',
	blobColumn: 'rdb$procedure_source',
};

export const INDEX_EXPRESSION_SOURCE: ChunkedSourceLocation = {
	table: 'rdb$indices',
	keyColumn: 'rdb$index_name',
	blobColumn: 'rdb$expression_source',
};

// O cast sem CHARACTER SET usa o charset padrão do banco (não o da conexão): com um padrão de
// 1 byte/char (ISO8859_1, NONE) o varchar(8000) tem só 8000 bytes e caracteres fora do charset
// padrão estouram com "Cannot transliterate". Os BLOBs de metadado são UNICODE_FSS, então
// utf8 explícito é sem perda e comporta 8000 chars (32000 bytes).
export const sourceChunkExpression = (blobColumn: string, fromExpression = '1'): string =>
	`cast(substring(${blobColumn} from ${fromExpression} for ${SOURCE_CHUNK_SIZE}) as varchar(${SOURCE_CHUNK_SIZE}) character set utf8)`;

const characterCount = (text: string): number => Array.from(text).length;

export const assertReadableSource = (chunk: string | null | undefined, label: string): string => {
	if (chunk === null || chunk === undefined) {
		return '';
	}

	if (typeof chunk !== 'string') {
		throw new Error(`Fonte ${label} veio como "${typeof chunk}" — esperava string (varchar).`);
	}

	if (chunk.includes(REPLACEMENT_CHARACTER)) {
		throw new Error(`Fonte ${label} contém U+FFFD — charset do metadado incompatível com a conexão UTF8.`);
	}

	return chunk;
};

export const requireCompleteSource = (source: string | null | undefined, label: string): string | null => {
	if (source === null || source === undefined) {
		return null;
	}

	assertReadableSource(source, label);

	if (characterCount(source) >= SOURCE_CHUNK_SIZE) {
		throw new Error(`Fonte ${label} atingiu ${SOURCE_CHUNK_SIZE} caracteres — precisa de leitura em chunks.`);
	}

	return source;
};

export const readChunkedSource = async (
	query: QueryFn,
	location: ChunkedSourceLocation,
	key: string,
	firstChunk: string | null | undefined,
): Promise<string | null> => {
	if (firstChunk === null || firstChunk === undefined) {
		return null;
	}

	const label = `${location.blobColumn} de ${key}`;
	let source = assertReadableSource(firstChunk, label);
	let lastChunk = source;
	let chunkIndex = 1;

	// cast(? as integer): parâmetro na posição FROM do substring não tem tipo inferível (-804).
	const nextChunkSql = `
		select ${sourceChunkExpression(`t.${location.blobColumn}`, 'cast(? as integer)')} source_chunk
		  from ${location.table} t
		 where t.${location.keyColumn} = ?
	`;

	while (characterCount(lastChunk) === SOURCE_CHUNK_SIZE) {
		if (chunkIndex >= MAX_CHUNKS) {
			throw new Error(`Fonte ${label} excede ${SOURCE_CHUNK_SIZE * MAX_CHUNKS} caracteres — aumente MAX_CHUNKS.`);
		}

		const rows = await query<{ source_chunk: string | null }>(nextChunkSql, [
			chunkIndex * SOURCE_CHUNK_SIZE + 1,
			key,
		]);
		const chunk = assertReadableSource(rows[0]?.source_chunk, label);

		if (chunk === '') {
			break;
		}

		source += chunk;
		lastChunk = chunk;
		chunkIndex += 1;
	}

	return source.trim() === '' ? null : source;
};
