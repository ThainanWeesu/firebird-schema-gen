import { QueryFn } from './connection';
import { matchesLikePattern } from './likePattern';

export interface IntrospectedView {
	name: string;
	source: string;
}

// O rdb$view_source é BLOB, mas o caminho de leitura de BLOB do driver fork
// (blobAsText/fetch assíncrono) não é exercitado pela API de produção e trava.
// Por isso o source é lido como VARCHAR via cast(substring(...)) em chunks —
// somente transaction.query com colunas simples, o caminho comprovado.
const CHUNK_SIZE = 8000;
const MAX_CHUNKS = 16;

interface ViewNameChunkRow {
	view_name: string;
	source_chunk: string | null;
}

interface ChunkRow {
	source_chunk: string | null;
}

export const introspectViews = async (query: QueryFn, excludePatterns: string[] = []): Promise<IntrospectedView[]> => {
	const firstChunkSql = `
		select trim(rel.rdb$relation_name) view_name,
		       cast(substring(rel.rdb$view_source from 1 for ${CHUNK_SIZE}) as varchar(${CHUNK_SIZE})) source_chunk
		  from rdb$relations rel
		 where rel.rdb$view_source is not null
		   and coalesce(rel.rdb$system_flag, 0) = 0
		 order by 1
	`;

	const rows = await query<ViewNameChunkRow>(firstChunkSql);

	const included = rows.filter((row) => !excludePatterns.some((pattern) => matchesLikePattern(row.view_name, pattern)));
	const views: IntrospectedView[] = [];

	for (const row of included) {
		const name = row.view_name.trim();
		let source = assertChunk(row.source_chunk, name);

		let chunkIndex = 1;
		while (source.length === chunkIndex * CHUNK_SIZE) {
			if (chunkIndex >= MAX_CHUNKS) {
				throw new Error(`View ${name} excede ${CHUNK_SIZE * MAX_CHUNKS} caracteres — aumente MAX_CHUNKS.`);
			}

			// cast(? as integer): parâmetro na posição FROM do substring não tem
			// tipo inferível pelo Firebird (dispara -804 Data type unknown).
			const nextChunkSql = `
				select cast(substring(rel.rdb$view_source from cast(? as integer) for ${CHUNK_SIZE}) as varchar(${CHUNK_SIZE})) source_chunk
				  from rdb$relations rel
				 where rel.rdb$relation_name = ?
			`;

			const next = await query<ChunkRow>(nextChunkSql, [chunkIndex * CHUNK_SIZE + 1, name]);
			const chunk = next.length > 0 ? (next[0].source_chunk ?? '') : '';

			if (chunk === '') {
				break;
			}

			source += assertChunk(chunk, name);
			chunkIndex += 1;
		}

		views.push({ name, source });
	}

	return views;
};

const assertChunk = (chunk: string | null, viewName: string): string => {
	if (chunk === null || chunk === undefined) {
		return '';
	}

	if (typeof chunk !== 'string') {
		throw new Error(
			`Trecho do rdb$view_source da view ${viewName} veio como "${typeof chunk}" — esperava string (varchar).`,
		);
	}

	return chunk;
};
