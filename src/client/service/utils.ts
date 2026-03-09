/**
 * Utility functions for client services
 */

import { UnknownError } from '@/common/exceptions/base';

/**
 * Validates, normalizes, and encodes an ID for safe use in URLs
 * @param id - The ID to validate and encode (string or will be converted to string)
 * @param idName - The name of the ID field (for error messages)
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

/**
 * Maps a backend API error response to a domain-specific exception and throws it.
 * Inspects the Axios response shape for an `errorName` field and throws the
 * corresponding error class from the provided map. Always throws (returns `never`),
 * so callers do not need a fallback `throw new UnknownError()`.
 *
 * @param error - The unknown error from an axios catch block
 * @param errorMap - A map of errorName strings to Error constructor functions
 */
export function handleApiError(
  error: unknown,

  errorMap: Record<string, new (...args: any[]) => Error>,
): never {
  if (error && typeof error === 'object' && 'response' in error &&
      error.response && typeof error.response === 'object' && 'data' in error.response) {
    const responseData = (error as { response: { data: Record<string, unknown> } }).response.data;
    const errorName = responseData.errorName as string;
    if (errorName && errorName in errorMap) {
      throw new errorMap[errorName]();
    }
  }
  throw new UnknownError();
}
