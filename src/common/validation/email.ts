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
