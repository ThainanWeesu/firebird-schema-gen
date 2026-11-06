import { requireCompleteSource, sourceChunkExpression } from './blobText';
import { QueryFn } from './connection';
import { matchesLikePattern } from './likePattern';
import { nullableTrim } from './tableGrouping';

export interface IntrospectedDomain {
	name: string;
	fieldType: number;
	fieldSubType: number | null;
	fieldScale: number | null;
	fieldPrecision: number | null;
	fieldLength: number | null;
	characterLength: number | null;
	dimensions: number | null;
	charsetName: string | null;
	notNull: boolean;
	defaultSource: string | null;
	validationSource: string | null;
	collationName: string | null;
}

interface DomainRow {
	domain_name: string;
	field_type: number;
	field_sub_type: number | null;
	field_scale: number | null;
	field_precision: number | null;
	field_length: number | null;
	char_len: number | null;
	dimensions: number | null;
	null_flag: number;
	charset_name: string | null;
	collation_id: number;
	collation_name: string | null;
	default_source: string | null;
	validation_source: string | null;
}

// Domains implícitos de coluna (RDB$1, RDB$2...) têm system_flag 0, por isso o filtro por prefixo.
const DOMAINS_SQL = `
	select trim(f.rdb$field_name) domain_name,
	       f.rdb$field_type field_type,
	       f.rdb$field_sub_type field_sub_type,
	       f.rdb$field_scale field_scale,
	       f.rdb$field_precision field_precision,
	       f.rdb$field_length field_length,
	       f.rdb$character_length char_len,
	       f.rdb$dimensions dimensions,
	       coalesce(f.rdb$null_flag, 0) null_flag,
	       trim(cs.rdb$character_set_name) charset_name,
	       coalesce(f.rdb$collation_id, 0) collation_id,
	       trim(co.rdb$collation_name) collation_name,
	       ${sourceChunkExpression('f.rdb$default_source')} default_source,
	       ${sourceChunkExpression('f.rdb$validation_source')} validation_source
	  from rdb$fields f
	  left join rdb$character_sets cs on cs.rdb$character_set_id = f.rdb$character_set_id
	  left join rdb$collations co on co.rdb$character_set_id = f.rdb$character_set_id
	                             and co.rdb$collation_id = f.rdb$collation_id
	 where f.rdb$field_name not starting with 'RDB$'
	   and coalesce(f.rdb$system_flag, 0) = 0
	 order by f.rdb$field_name
`;

const readOptionalSource = (source: string | null, label: string): string | null => {
	const complete = requireCompleteSource(source, label);

	return complete === null || complete.trim() === '' ? null : complete;
};

export const introspectDomains = async (
	query: QueryFn,
	excludePatterns: string[] = [],
): Promise<IntrospectedDomain[]> => {
	const rows = await query<DomainRow>(DOMAINS_SQL);
	const domains: IntrospectedDomain[] = [];

	for (const row of rows) {
		const name = row.domain_name.trim();

		if (excludePatterns.some((pattern) => matchesLikePattern(name, pattern))) {
			continue;
		}

		const collationName = nullableTrim(row.collation_name);

		if (row.collation_id !== 0 && collationName === null) {
			throw new Error(
				`Domain ${name} referencia rdb$collation_id=${row.collation_id} sem correspondência em rdb$collations.`,
			);
		}

		domains.push({
			name,
			fieldType: row.field_type,
			fieldSubType: row.field_sub_type,
			fieldScale: row.field_scale,
			fieldPrecision: row.field_precision,
			fieldLength: row.field_length,
			characterLength: row.char_len,
			dimensions: row.dimensions,
			charsetName: nullableTrim(row.charset_name),
			notNull: row.null_flag === 1,
			defaultSource: readOptionalSource(row.default_source, `rdb$default_source de ${name}`),
			validationSource: readOptionalSource(row.validation_source, `rdb$validation_source de ${name}`),
			collationName: row.collation_id === 0 ? null : collationName,
		});
	}

	return domains.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
};
