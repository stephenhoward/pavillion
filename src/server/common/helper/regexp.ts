/**
 * Escapes regular-expression metacharacters so a literal string can be
 * interpolated into a RegExp source — typically one entry of an alternation
 * built from a list of literals (`list.map(escapeRegExp).join('|')`).
 *
 * @param value - A literal string
 * @returns The string with every metacharacter backslash-escaped
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
