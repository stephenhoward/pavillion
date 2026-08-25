/**
 * Basic email format validation for client-side use.
 *
 * Uses the same pattern as the HTML5 email input type spec.
 * Server-side validation remains the authoritative check.
 *
 * @param email - The email string to validate
 * @returns true if the email matches basic format requirements
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Normalizes an email address for case-insensitive storage and lookup.
 *
 * Trims surrounding whitespace and lowercases the address. This is the single
 * source of truth applied at every email read and write boundary so that a
 * lookup never misses an account whose address was stored in a different case.
 *
 * Defensive contract: nullish or non-string input collapses to `''` rather
 * than throwing. Callers gate the format upstream via {@link isValidEmail}; an
 * empty-string lookup simply returns no row, which is benign.
 *
 * Case-folding contract: JS `toLowerCase()` performs full Unicode case
 * folding, which can fold more than SQL `LOWER` does (ASCII-only on SQLite,
 * collation-dependent on PostgreSQL) — this function, not the database, is
 * the case-collapse guarantee. The DB unique index on `account.email`
 * enforces exact-string uniqueness only (see migration 0037).
 *
 * @param email - The email string to normalize
 * @returns The trimmed, lowercased email, or `''` for nullish/empty input
 */
export function normalizeEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}
