/**
 * URI Validation Utilities
 *
 * Pure validation functions for URI protocol/scheme checking.
 * Used across domains for security validation of remote URIs.
 */

/**
 * Checks if the current environment allows HTTP protocol.
 * HTTP is only allowed in development and test environments.
 *
 * @returns True if HTTP is allowed, false otherwise
 */
function isHttpAllowed(): boolean {
  const env = process.env.NODE_ENV;
  return env === 'development' || env === 'test';
}

/**
 * Checks if a hostname is localhost (for development purposes).
 *
 * @param hostname - The hostname to check
 * @returns True if the hostname is localhost
 */
function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Validates that a URI uses an acceptable protocol.
 *
 * - HTTPS is always allowed
 * - HTTP is only allowed for localhost in development/test environments
 *
 * @param uri - The URI to validate
 * @returns True if the protocol is valid, false otherwise
 */
export function validateActorUriProtocol(uri: string): boolean {
  if (!uri || typeof uri !== 'string') {
    return false;
  }

  let url: URL;
  try {
    url = new URL(uri);
  }
  catch {
    return false;
  }

  if (url.protocol === 'https:') {
    return true;
  }

  if (url.protocol === 'http:') {
    return isHttpAllowed() && isLocalhost(url.hostname);
  }

  return false;
}
