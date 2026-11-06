import { QueryFn } from './connection';
import { matchesLikePattern } from './likePattern';

const IMPLICIT_GENERATOR_NAME = /^(RDB|SQL)\$\d+$/;

interface GeneratorRow {
	generator_name: string;
}

export const introspectSequences = async (query: QueryFn, excludePatterns: string[] = []): Promise<string[]> => {
	const generatorsSql = `
		select trim(g.rdb$generator_name) generator_name
		  from rdb$generators g
		 where coalesce(g.rdb$system_flag, 0) = 0
		 order by g.rdb$generator_name
	`;

	const rows = await query<GeneratorRow>(generatorsSql);

	return rows
		.map((row) => row.generator_name.trim())
		.filter((name) => !IMPLICIT_GENERATOR_NAME.test(name))
		.filter((name) => !excludePatterns.some((pattern) => matchesLikePattern(name, pattern)))
		.sort();
};
