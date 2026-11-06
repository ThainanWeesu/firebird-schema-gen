import { ENV_PATH, PACKAGE_ROOT, envFileLoaded } from './env'; // PRIMEIRO import: carrega o .env

import path from 'path';

import config from '../seenc.firebird.config';
import { SchemaGenConfig } from './config';
import { TimeoutError, getConnectionOptionsFromEnv, withConnection } from './connection';
import { introspectChecks } from './introspectChecks';
import { introspectDomains } from './introspectDomains';
import { introspectExceptions } from './introspectExceptions';
import { introspectForeignKeys } from './introspectForeignKeys';
import { introspectIndexes } from './introspectIndexes';
import { introspectProcedures } from './introspectProcedures';
import { introspectSequences } from './introspectSequences';
import { getDatabaseDefaultCharset, introspectTables } from './introspectTables';
import { introspectTriggers } from './introspectTriggers';
import { introspectUncoveredTables } from './introspectUncoveredTables';
import { introspectUniques } from './introspectUniques';
import { introspectViewColumns } from './introspectViewColumns';
import { introspectViews } from './introspectViews';
import { renderChecks } from './renderChecks';
import { renderDomain } from './renderDomain';
import { renderException } from './renderException';
import { renderForeignKeys } from './renderForeignKeys';
import { renderIndexes } from './renderIndexes';
import { renderProcedure } from './renderProcedure';
import { renderSequence } from './renderSequence';
import { renderTable } from './renderTable';
import { renderTrigger } from './renderTrigger';
import { renderUniques } from './renderUniques';
import { renderView } from './renderView';
import { groupByTable } from './tableGrouping';
import { deleteSqlFile, listSqlFiles, writeSqlFile } from './writeFiles';

interface GeneratedFile {
	fileName: string;
	content: string;
}

interface WrittenFiles {
	dir: string;
	names: string[];
	seen: Set<string>;
}

interface KindFailure {
	label: string;
	message: string;
}

const writtenByDir = new Map<string, WrittenFiles>();
const kindFailures: KindFailure[] = [];

const sqlFileName = (objectName: string): string => `${objectName.toUpperCase()}.sql`;

const resolveOutDir = (kind: keyof SchemaGenConfig['out']): string | undefined => {
	const dir = config.out[kind];
	return dir === undefined ? undefined : path.resolve(PACKAGE_ROOT, dir);
};

const writeGeneratedFile = (outDir: string, file: GeneratedFile): string => {
	const key = outDir.toLowerCase();
	const written = writtenByDir.get(key) ?? { dir: outDir, names: [], seen: new Set<string>() };
	const fileKey = file.fileName.toLowerCase();

	if (written.seen.has(fileKey)) {
		throw new Error(
			`Arquivo gerado duas vezes em ${outDir}: ${file.fileName} (pastas de saída repetidas no config?).`,
		);
	}

	written.seen.add(fileKey);
	written.names.push(file.fileName);
	writtenByDir.set(key, written);

	return writeSqlFile(outDir, file.fileName, file.content);
};

const generateKind = async (
	label: string,
	outDir: string | undefined,
	load: () => Promise<GeneratedFile[]>,
): Promise<number> => {
	if (outDir === undefined) {
		return 0;
	}

	try {
		const files = await load();

		for (const file of files) {
			writeGeneratedFile(outDir, file);
		}

		console.log(`${files.length} ${label} -> ${outDir}`);

		return files.length;
	} catch (error) {
		// Timeout deixa a conexão inutilizável; qualquer outro erro isola só este tipo de objeto.
		if (error instanceof TimeoutError) {
			throw error;
		}

		const message = error instanceof Error ? error.message : String(error);
		kindFailures.push({ label, message });
		console.error(`Falha ao gerar ${label}: ${message}`);

		return 0;
	}
};

const filesPerTable = <T extends { tableName: string }>(items: T[], render: (group: T[]) => string): GeneratedFile[] =>
	[...groupByTable(items)].map(([tableName, group]) => ({
		fileName: sqlFileName(tableName),
		content: render(group),
	}));

const warnMissingSource = (kind: string, name: string, source: string | null): void => {
	if (source === null) {
		console.warn(
			`Aviso: ${kind} ${name} sem fonte no metadado (criado via BLR?) — arquivo gerado só com comentário.`,
		);
	}
};

// Órfãos: .sql no destino que não correspondem a nenhum objeto atual.
// Verificado APÓS a escrita — uma execução que falha nunca apaga nada.
const handleOrphans = (outDir: string, written: string[]): void => {
	const writtenSet = new Set(written.map((name) => name.toLowerCase()));
	const orphans = listSqlFiles(outDir).filter((name) => !writtenSet.has(name.toLowerCase()));

	if (orphans.length === 0) {
		return;
	}

	if (config.cleanStale) {
		for (const name of orphans) {
			deleteSqlFile(outDir, name);
			console.log(`  removido (órfão): ${name}`);
		}
		return;
	}

	console.warn(`Aviso: ${orphans.length} arquivo(s) .sql órfão(s) em ${outDir} (objetos removidos do banco?):`);

	for (const name of orphans) {
		console.warn(`  - ${name}`);
	}

	console.warn('Defina cleanStale: true no seenc.firebird.config.ts para removê-los automaticamente.');
};

const run = async (): Promise<void> => {
	const startedAt = Date.now();

	if (!envFileLoaded) {
		console.warn(`Aviso: .env não encontrado em ${ENV_PATH} (usando apenas o ambiente do processo).`);
	}

	const { options, missing } = getConnectionOptionsFromEnv();

	if (missing.length > 0) {
		console.error('Variáveis de ambiente obrigatórias ausentes ou vazias:');

		for (const name of missing) {
			console.error(`  - ${name}`);
		}

		console.error(`Arquivo .env esperado em: ${ENV_PATH}`);
		process.exit(1);
	}

	const viewsOutDir = path.resolve(PACKAGE_ROOT, config.out.views);
	const tablesOutDir = path.resolve(PACKAGE_ROOT, config.out.tables);
	const exclude = config.exclude ?? [];

	console.log(`.env: ${ENV_PATH}`);
	console.log(`Destino (views): ${viewsOutDir}`);
	console.log(`Destino (tables): ${tablesOutDir}`);
	console.log(`Conectando em ${options.host}:${options.port} (db: ${options.database}, user: ${options.user})...`);

	let viewCount = 0;
	let tableCount = 0;
	const otherCounts: Record<string, number> = {};

	await withConnection(
		options,
		async (query) => {
			await query('select 1 as ok from rdb$database');
			console.log('Probe OK — transação e query respondendo.');

			const views = await introspectViews(query, exclude);
			console.log(`${views.length} view(s) encontrada(s).`);

			const columnsByView = config.viewColumnList === 'always' ? await introspectViewColumns(query) : undefined;

			for (const view of views) {
				const content = renderView(view, columnsByView?.get(view.name));
				const fileName = `${view.name.toUpperCase()}.sql`;
				const filePath = writeGeneratedFile(viewsOutDir, { fileName, content });
				viewCount += 1;
				console.log(`  -> ${filePath}`);
			}

			const dbDefaultCharset = await getDatabaseDefaultCharset(query);
			const tables = await introspectTables(query, exclude);
			console.log(
				`${tables.length} tabela(s) encontrada(s) (charset padrão do banco: ${dbDefaultCharset ?? 'desconhecido'}).`,
			);

			for (const table of tables) {
				const content = renderTable(table, dbDefaultCharset);
				const fileName = `${table.name.toUpperCase()}.sql`;
				const filePath = writeGeneratedFile(tablesOutDir, { fileName, content });
				tableCount += 1;
				console.log(`  -> ${filePath}`);
			}

			otherCounts.domains = await generateKind('domínio(s)', resolveOutDir('domains'), async () =>
				(await introspectDomains(query, exclude)).map((domain) => ({
					fileName: sqlFileName(domain.name),
					content: renderDomain(domain, dbDefaultCharset),
				})),
			);

			otherCounts.sequences = await generateKind('sequence(s)', resolveOutDir('sequences'), async () =>
				(await introspectSequences(query, exclude)).map((name) => ({
					fileName: sqlFileName(name),
					content: renderSequence(name),
				})),
			);

			otherCounts.exceptions = await generateKind('exception(s)', resolveOutDir('exceptions'), async () =>
				(await introspectExceptions(query, exclude)).map((exception) => ({
					fileName: sqlFileName(exception.name),
					content: renderException(exception),
				})),
			);

			otherCounts.uniques = await generateKind('arquivo(s) de unique(s)', resolveOutDir('uniques'), async () =>
				filesPerTable(await introspectUniques(query, exclude), renderUniques),
			);

			otherCounts.checks = await generateKind('arquivo(s) de check(s)', resolveOutDir('checks'), async () =>
				filesPerTable(await introspectChecks(query, exclude), renderChecks),
			);

			otherCounts.indexes = await generateKind('arquivo(s) de índice(s)', resolveOutDir('indexes'), async () =>
				filesPerTable(await introspectIndexes(query, exclude), renderIndexes),
			);

			otherCounts.foreignKeys = await generateKind(
				'arquivo(s) de FK(s)',
				resolveOutDir('foreignKeys'),
				async () => filesPerTable(await introspectForeignKeys(query, exclude), renderForeignKeys),
			);

			otherCounts.procedures = await generateKind('procedure(s)', resolveOutDir('procedures'), async () =>
				(await introspectProcedures(query, exclude)).map((procedure) => {
					warnMissingSource('procedure', procedure.name, procedure.source);
					return {
						fileName: sqlFileName(procedure.name),
						content: renderProcedure(procedure, dbDefaultCharset),
					};
				}),
			);

			otherCounts.triggers = await generateKind('trigger(s)', resolveOutDir('triggers'), async () =>
				(await introspectTriggers(query, exclude)).map((trigger) => {
					warnMissingSource('trigger', trigger.name, trigger.source);
					return { fileName: sqlFileName(trigger.name), content: renderTrigger(trigger) };
				}),
			);

			try {
				const uncovered = await introspectUncoveredTables(query, exclude);

				if (uncovered.length > 0) {
					console.warn(`Aviso: ${uncovered.length} tabela(s) fora do escopo do gerador (não geradas):`);

					for (const table of uncovered) {
						console.warn(`  - ${table.name} (${table.kind})`);
					}
				}
			} catch (error) {
				if (error instanceof TimeoutError) {
					throw error;
				}

				const message = error instanceof Error ? error.message : String(error);
				kindFailures.push({ label: 'verificação de tabelas fora do escopo', message });
				console.error(`Falha na verificação de tabelas fora do escopo: ${message}`);
			}
		},
		{ connectTimeoutMs: config.connectTimeoutMs, queryTimeoutMs: config.queryTimeoutMs },
	);

	// Destinos iguais: uma varredura só com a lista combinada, senão a
	// primeira chamada trataria os arquivos da outra categoria como órfãos.
	for (const written of writtenByDir.values()) {
		handleOrphans(written.dir, written.names);
	}

	const otherSummary = Object.entries(otherCounts)
		.filter(([, count]) => count > 0)
		.map(([kind, count]) => `${count} ${kind}`)
		.join(', ');

	console.log(
		`Concluído: ${viewCount} view(s) + ${tableCount} tabela(s)${otherSummary ? ` + ${otherSummary}` : ''} em ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`,
	);
	console.log('Não gerados: grants, comentários, valores de generators, UDFs e collations próprias.');
	console.log(
		'Ordem de dependência entre objetos (views sobre views, procedures x views) não é resolvida pelo gerador.',
	);

	if (kindFailures.length > 0) {
		console.error(`${kindFailures.length} etapa(s) com falha (as demais foram geradas normalmente):`);

		for (const failure of kindFailures) {
			console.error(`  - ${failure.label}: ${failure.message}`);
		}

		process.exit(1);
	}
};

run().catch((error) => {
	console.error('Falha ao gerar schema:', error instanceof Error ? error.message : error);
	process.exit(1); // também encerra sockets pendurados de timeouts
});
