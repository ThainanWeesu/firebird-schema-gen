import { IntrospectedView } from './introspectViews';

const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');

export const renderView = (view: IntrospectedView, columns?: string[]): string => {
	const source = normalizeNewlines(view.source).trim();
	const columnList =
		columns && columns.length > 0 ? ` (${columns.map((column) => column.toLowerCase()).join(', ')})` : '';

	return `create or alter view ${view.name.toLowerCase()}${columnList}\nas\n${source}\n;\n`;
};
