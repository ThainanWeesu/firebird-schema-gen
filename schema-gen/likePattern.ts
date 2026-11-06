// Matching estilo LIKE do SQL ('%' e '_'), case-insensitive.
export const matchesLikePattern = (value: string, pattern: string): boolean => {
	const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
	return new RegExp(`^${escaped}$`, 'i').test(value);
};
