/**
 * Centralized error logging utility for consistent server-side error handling.
 *
 * This module provides functions to log errors server-side while ensuring
 * sensitive information (stack traces, internal paths, etc.) is never exposed
 * to clients.
 */

/**
 * Logs an error with context information for debugging.
 *
 * @param error - The error to log
 * @param context - Additional context about where/when the error occurred
 */
export function logError(error: unknown, context: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ${context}:`);

  if (error instanceof Error) {
    console.error(`  Error: ${error.message}`);
    if (error.stack) {
      console.error(`  Stack: ${error.stack}`);
    }
  }
  else {
    console.error(`  Error:`, error);
  }
}

/**
 * Gets a safe, user-friendly error message that doesn't expose system details.
 * For known error types, returns the error message. For unknown errors,
 * returns a generic message.
 *
 * @param error - The error to get a message from
 * @param knownErrorTypes - Array of known error constructors that are safe to expose
 * @returns A safe error message for client response
 */
export function getSafeErrorMessage(
  error: unknown,
  knownErrorTypes: Array<new (...args: any[]) => Error> = [],
): string {
  if (error instanceof Error) {
    // Check if this is a known, safe error type
    for (const ErrorType of knownErrorTypes) {
      if (error instanceof ErrorType) {
        return error.message;
      }
    }
  }

  // For unknown errors, return generic message
  return "An unexpected error occurred";
}

/**
 * Checks if an error is an instance of any of the provided error types.
 *
 * @param error - The error to check
 * @param errorTypes - Array of error constructors to check against
 * @returns true if error matches any of the types
 */
export function isKnownError(
  error: unknown,
  errorTypes: Array<new (...args: any[]) => Error>,
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return errorTypes.some(ErrorType => error instanceof ErrorType);
}
