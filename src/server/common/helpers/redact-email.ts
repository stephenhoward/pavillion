/**
 * Redacts an email address for safe logging while preserving some context.
 *
 * @param email - The email address to redact. Accepts unknown so forged
 *   non-string request-body values can be passed safely; any non-string
 *   input redacts to 'unknown' rather than throwing or leaking its shape.
 * @returns Redacted email in format: first2chars***@domain, or 'unknown' if invalid
 *
 * @example
 * redactEmail('admin@example.com') // Returns: 'ad***@example.com'
 * redactEmail('a@example.com')     // Returns: 'a***@example.com'
 * redactEmail('invalid')           // Returns: 'unknown'
 * redactEmail(undefined)           // Returns: 'unknown'
 * redactEmail({ x: 1 })            // Returns: 'unknown'
 * redactEmail(42)                  // Returns: 'unknown'
 */
export function redactEmail(email: unknown): string {
  // Reject non-string input (including null/undefined) and empty/whitespace
  // strings. Guarding on typeof keeps forged non-string credential bodies from
  // throwing on .trim() and from leaking their shape into logs (e.g. an
  // array-wrapped address would otherwise coerce back to a real email).
  if (typeof email !== 'string' || email.trim() === '') {
    return 'unknown';
  }

  // Basic email validation - must contain @ and have parts before and after
  const emailPattern = /^[^\s@]+@[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return 'unknown';
  }

  // Split email into local part and domain
  const atIndex = email.indexOf('@');
  const localPart = email.substring(0, atIndex);
  const domain = email.substring(atIndex + 1);

  // If domain is empty after @, it's invalid
  if (domain.length === 0) {
    return 'unknown';
  }

  // Keep first 2 characters of local part (or just 1 if local part is 1 char)
  const visibleChars = localPart.substring(0, Math.min(2, localPart.length));

  return `${visibleChars}***@${domain}`;
}
