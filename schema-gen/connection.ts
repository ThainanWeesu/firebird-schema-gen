import firebird from '@weesurepo/node-firebird';

export interface FirebirdConnectionOptions {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
}

export interface ConnectionBehavior {
	/** Timeout do attach inicial (ms). Padrão: 10000. */
	connectTimeoutMs?: number;
	/** Timeout por query (ms). Padrão: 60000. */
	queryTimeoutMs?: number;
}

export type QueryFn = <R>(sql: string, params?: unknown[]) => Promise<R[]>;

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_QUERY_TIMEOUT_MS = 60_000;
const CLEANUP_TIMEOUT_MS = 5_000;

export class TimeoutError extends Error {
	constructor(label: string, ms: number) {
		super(`${label} excedeu ${ms}ms (servidor inacessível ou sem resposta).`);
		this.name = 'TimeoutError';
	}
}

// Promise.race registra handlers em todos os inputs: uma rejeição tardia
// do perdedor NÃO vira unhandledRejection.
const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
	let timer: NodeJS.Timeout;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
	});

	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
};

// Fecha a conexão sem esperar resposta do servidor. Usado quando o servidor
// está sem resposta: detach educado enfileira op_detach e aguardaria para
// sempre. O Firebird limpa o attachment pendurado quando o socket fecha.
const hardClose = (db: any): void => {
	try {
		db.connection?.disconnect();
	} catch {
		/* ignore */
	}

	try {
		db.connection?._socket?.destroy?.();
	} catch {
		/* ignore */
	}
};

// Mesmas opções de transação de leitura do helper de produção
// (firebird.helper.ts -> ExecuteReadSelectSQL).
const READ_ONLY_TRANSACTION_OPTIONS = {
	autoCommit: false,
	autoUndo: true,
	ignoreLimbo: false,
	readOnly: true,
	isolation: (firebird as any).ISOLATION_READ_COMMITTED_READ_ONLY,
	wait: false,
	waitTimeout: 0,
};

export const withConnection = async <T>(
	options: FirebirdConnectionOptions,
	handler: (query: QueryFn) => Promise<T>,
	behavior: ConnectionBehavior = {},
): Promise<T> => {
	const connectTimeoutMs = behavior.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
	const queryTimeoutMs = behavior.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;

	let timedOut = false;

	const attachPromise = new Promise<any>((resolve, reject) => {
		let settled = false;

		firebird.attach(
			{
				...options,
				encoding: 'UTF8',
				lowercase_keys: true,
			},
			(err: any, connection: any) => {
				// O driver pode invocar este callback mais de uma vez (erro de
				// socket pós-attach reusa o callback do construtor), e o attach
				// pode completar depois do timeout — nos dois casos, só liberar.
				if (err) {
					if (!settled) {
						settled = true;
						reject(err);
					}
					return;
				}

				if (settled || timedOut) {
					hardClose(connection);
					return;
				}

				settled = true;
				resolve(connection);
			},
		);
	});

	let db: any;

	try {
		db = await withTimeout(attachPromise, connectTimeoutMs, 'attach');
	} catch (error) {
		if (error instanceof TimeoutError) {
			timedOut = true;
		}
		throw error;
	}

	let transaction: any;

	try {
		transaction = await withTimeout(
			new Promise<any>((resolve, reject) => {
				db.transaction(READ_ONLY_TRANSACTION_OPTIONS, (err: any, trans: any) =>
					err ? reject(err) : resolve(trans),
				);
			}),
			queryTimeoutMs,
			'start transaction',
		);
	} catch (error) {
		hardClose(db);
		throw error;
	}

	const query: QueryFn = (sql, params = []) => {
		const snippet = sql.trim().slice(0, 80).replace(/\s+/g, ' ');

		return withTimeout(
			new Promise((resolve, reject) => {
				transaction.query(sql, params, (err: any, rows: any) =>
					err ? reject(new Error(`Query falhou: "${snippet}" — ${err?.message ?? err}`)) : resolve(rows ?? []),
				);
			}),
			queryTimeoutMs,
			`query "${snippet}"`,
		);
	};

	try {
		return await handler(query);
	} finally {
		try {
			await withTimeout(
				new Promise<void>((resolve, reject) => transaction.commit((err: any) => (err ? reject(err) : resolve()))),
				CLEANUP_TIMEOUT_MS,
				'commit',
			);
			await withTimeout(
				new Promise<void>((resolve) => db.detach(() => resolve(), true)),
				CLEANUP_TIMEOUT_MS,
				'detach',
			);
		} catch {
			hardClose(db);
		}
	}
};

// Valor vazio conta como ausente (Number('') === 0 viraria porta 0).
const readEnv = (name: string): string | undefined => {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
};

export interface EnvConnectionResult {
	options: FirebirdConnectionOptions;
	missing: string[];
}

export const getConnectionOptionsFromEnv = (): EnvConnectionResult => {
	const required: Record<string, string | undefined> = {
		REPOSITORY_DB_HOST: readEnv('REPOSITORY_DB_HOST'),
		REPOSITORY_DB_DATABASE: readEnv('REPOSITORY_DB_DATABASE'),
		REPOSITORY_DB_USER: readEnv('REPOSITORY_DB_USER'),
		REPOSITORY_DB_PASSWORD: readEnv('REPOSITORY_DB_PASSWORD'),
	};

	const missing = Object.entries(required)
		.filter(([, value]) => value === undefined)
		.map(([name]) => name);

	const rawPort = readEnv('REPOSITORY_DB_PORT');
	const port = rawPort === undefined ? 3050 : Number(rawPort);

	if (Number.isNaN(port) || !Number.isInteger(port) || port <= 0) {
		missing.push(`REPOSITORY_DB_PORT (valor inválido: "${rawPort}")`);
	}

	return {
		missing,
		options: {
			host: required.REPOSITORY_DB_HOST ?? '',
			port: Number.isInteger(port) && port > 0 ? port : 3050,
			database: required.REPOSITORY_DB_DATABASE ?? '',
			user: required.REPOSITORY_DB_USER ?? '',
			password: required.REPOSITORY_DB_PASSWORD ?? '',
		},
	};
};
