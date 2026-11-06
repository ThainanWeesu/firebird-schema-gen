const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const WINDOWS_1252_DECODER = new TextDecoder('windows-1252');

// Colunas de metadado com charset NONE (ex.: rdb$message) guardam os bytes do cliente que criou o objeto,
// e o driver sempre decodifica texto como UTF-8. Lidas como OCTETS, voltam como bytes crus: UTF-8 válido
// vale como está, senão são bytes WIN1252 (superset das letras acentuadas do ISO8859_1).
export const decodeMetadataBytes = (bytes: Buffer): string => {
	try {
		return UTF8_DECODER.decode(bytes);
	} catch {
		return WINDOWS_1252_DECODER.decode(bytes);
	}
};
