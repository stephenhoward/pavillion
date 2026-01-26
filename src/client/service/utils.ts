/**
 * Utility functions for client services
 */

/**
 * Validates, normalizes, and encodes an ID for safe use in URLs
 * @param id The ID to validate and encode (string or will be converted to string)
 * @param idName The name of the ID field (for error messages)
 * @returns The trimmed and URL-encoded ID
 * @throws Error if the ID is empty after trimming
 */
export function validateAndEncodeId(id: string | any, idName: string = 'ID'): string {
  // Convert to string if not already (handles objects, numbers, etc.)
  const stringId = String(id);
  const trimmedId = stringId.trim();
  if (!trimmedId) {
    throw new Error(`${idName} cannot be empty`);
  }
  return encodeURIComponent(trimmedId);
}
