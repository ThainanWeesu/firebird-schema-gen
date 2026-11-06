import { assertReadableSource } from './blobText';
import { QueryFn } from './connection';
import { matchesLikePattern } from './likePattern';
import { decodeMetadataBytes } from './metadataText';

export interface IntrospectedException {
	name: string;
	message: string;
}

interface ExceptionRow {
	exception_name: string;
	message_bytes: Buffer | null;
}

export const introspectExceptions = async (
	query: QueryFn,
	excludePatterns: string[] = [],
): Promise<IntrospectedException[]> => {
	const exceptionsSql = `
		select trim(e.rdb$exception_name) exception_name,
		       cast(e.rdb$message as varchar(1021) character set octets) message_bytes
		  from rdb$exceptions e
		 where coalesce(e.rdb$system_flag, 0) = 0
		 order by e.rdb$exception_number
	`;

	const rows = await query<ExceptionRow>(exceptionsSql);
	const exceptions: IntrospectedException[] = [];

	for (const row of rows) {
		const name = row.exception_name.trim();

		if (excludePatterns.some((pattern) => matchesLikePattern(name, pattern))) {
			continue;
		}

		if (row.message_bytes === null || row.message_bytes === undefined) {
			throw new Error(`Exception ${name} sem mensagem em rdb$exceptions.rdb$message.`);
		}

		if (!Buffer.isBuffer(row.message_bytes)) {
			throw new Error(
				`rdb$message de ${name} veio como "${typeof row.message_bytes}" — esperava bytes (varchar octets).`,
			);
		}

		exceptions.push({
			name,
			message: assertReadableSource(decodeMetadataBytes(row.message_bytes), `rdb$message de ${name}`),
		});
	}

	return exceptions;
};
