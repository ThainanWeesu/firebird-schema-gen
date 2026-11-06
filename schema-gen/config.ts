export interface SchemaGenConfig {
	out: {
		tables: string;
		views: string;
		/** Cada pasta abaixo é opcional: sem ela, o tipo de objeto não é gerado. */
		domains?: string;
		sequences?: string;
		exceptions?: string;
		uniques?: string;
		checks?: string;
		indexes?: string;
		foreignKeys?: string;
		triggers?: string;
		procedures?: string;
	};
	exclude?: string[];
	/**
	 * 'always': emite "(col1, col2, ...)" após o nome da view (estilo isql extract).
	 * 'never' (padrão): omite, casando com o estilo dos arquivos de referência weesu-sql.
	 * ATENÇÃO: se uma view foi criada COM lista de colunas explícita que renomeia
	 * colunas, 'never' gera DDL que muda os nomes (ou falha em expressões sem alias).
	 * Não há como detectar isso pelos metadados do Firebird.
	 */
	viewColumnList?: 'always' | 'never';
	/** Remove .sql órfãos do diretório de saída após geração bem-sucedida. Padrão: false (só reporta). */
	cleanStale?: boolean;
	/** Timeout do attach inicial em ms. Padrão: 10000. */
	connectTimeoutMs?: number;
	/** Timeout por query em ms. Padrão: 60000. */
	queryTimeoutMs?: number;
}

export const defineConfig = (config: SchemaGenConfig): SchemaGenConfig => config;
