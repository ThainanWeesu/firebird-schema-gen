import { defineConfig } from './schema-gen/config';

export default defineConfig({
	out: {
		tables: './schema/tables',
		views: './schema/views',
		domains: './schema/domains',
		sequences: './schema/sequences',
		exceptions: './schema/exceptions',
		uniques: './schema/uniques',
		checks: './schema/checks',
		indexes: './schema/indexes',
		foreignKeys: './schema/foreign-keys',
		triggers: './schema/triggers',
		procedures: './schema/procedures',
	},
	exclude: ['RDB$%', 'MON$%'],
});
