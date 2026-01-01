/**
 * Password validation result interface
 */
export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Minimum required password length
 */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Check if password contains letters (a-z, A-Z)
 */
function hasLetters(password: string): boolean {
  return /[a-zA-Z]/.test(password);
}

/**
 * Check if password contains numbers (0-9)
 */
function hasNumbers(password: string): boolean {
  return /[0-9]/.test(password);
}

/**
 * Check if password contains special characters (any non-alphanumeric)
 */
function hasSpecialCharacters(password: string): boolean {
  return /[^a-zA-Z0-9]/.test(password);
}

/**
 * Validates a password against security requirements.
 *
 * Requirements:
 * - Minimum 8 characters
 * - Must contain at least 2 of 3 character types:
 *   - Letters (a-z, A-Z)
 *   - Numbers (0-9)
 *   - Special characters (any non-alphanumeric)
 *
 * @param password - The password to validate
 * @returns Validation result with valid boolean and array of i18n error keys
 *
 * @example
 * validatePassword("password1") // { valid: true, errors: [] }
 * validatePassword("password")  // { valid: false, errors: ["password_needs_variety"] }
 * validatePassword("short1!")   // { valid: false, errors: ["password_too_short"] }
 */
export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  // Check minimum length
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push('password_too_short');
  }

  // Count character types present
  let characterTypes = 0;
  if (hasLetters(password)) characterTypes++;
  if (hasNumbers(password)) characterTypes++;
  if (hasSpecialCharacters(password)) characterTypes++;

  // Require at least 2 of 3 character types
  if (characterTypes < 2) {
    errors.push('password_needs_variety');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
