import fs from 'fs';
import path from 'path';

export const writeSqlFile = (outDir: string, fileName: string, content: string): string => {
	if (!path.isAbsolute(outDir)) {
		throw new Error(`writeSqlFile espera diretório absoluto, recebeu: "${outDir}"`);
	}

	fs.mkdirSync(outDir, { recursive: true });

	const filePath = path.join(outDir, fileName);
	fs.writeFileSync(filePath, content, 'utf-8');
	return filePath;
};

export const listSqlFiles = (outDir: string): string[] => {
	if (!fs.existsSync(outDir)) {
		return [];
	}

	return fs
		.readdirSync(outDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
		.map((entry) => entry.name);
};

export const deleteSqlFile = (outDir: string, fileName: string): void => {
	fs.unlinkSync(path.join(outDir, fileName));
};
