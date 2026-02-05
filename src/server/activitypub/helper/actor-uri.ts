/**
 * Parses an ActivityPub actor URI and determines the actor type.
 *
 * Actor types:
 * - Person actors: /users/{id} path (e.g., https://example.com/users/alice)
 * - Calendar actors: /calendars/{id} path (e.g., https://example.com/calendars/events)
 */

export type ActorType = 'person' | 'calendar';

export interface ParsedActorUri {
  type: ActorType;
  id: string;
}

export class InvalidActorUriError extends Error {
  constructor(message: string, public readonly uri: string) {
    super(message);
    this.name = 'InvalidActorUriError';
  }
}

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
 * Validates that an actor URI uses an acceptable protocol.
 *
 * - HTTPS is always allowed
 * - HTTP is only allowed for localhost in development/test environments
 *
 * @param uri - The actor URI to validate
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

/**
 * Parses an ActivityPub actor URI and extracts the actor type and ID.
 */
export function parseActorUri(uri: string): ParsedActorUri {
  if (!uri || typeof uri !== 'string') {
    throw new InvalidActorUriError('Actor URI must be a non-empty string', uri);
  }

  let url: URL;
  try {
    url = new URL(uri);
  }
  catch {
    throw new InvalidActorUriError('Invalid URL format', uri);
  }

  if (!validateActorUriProtocol(uri)) {
    if (url.protocol === 'http:') {
      if (!isLocalhost(url.hostname)) {
        throw new InvalidActorUriError('HTTP protocol is only allowed for localhost', uri);
      }
      else {
        throw new InvalidActorUriError('HTTP protocol is not allowed in production environment', uri);
      }
    }
    throw new InvalidActorUriError('Actor URI must use HTTPS protocol', uri);
  }

  const pathname = url.pathname;
  const segments = pathname
    .split('/')
    .filter(segment => segment.length > 0)
    .map(segment => decodeURIComponent(segment));

  if (segments.length < 2) {
    throw new InvalidActorUriError('Actor URI path must contain type and ID segments', uri);
  }

  const usersIndex = segments.indexOf('users');
  if (usersIndex !== -1 && usersIndex < segments.length - 1) {
    const id = segments[usersIndex + 1];
    if (id) {
      return { type: 'person', id };
    }
  }

  const calendarsIndex = segments.indexOf('calendars');
  if (calendarsIndex !== -1 && calendarsIndex < segments.length - 1) {
    const id = segments[calendarsIndex + 1];
    if (id) {
      return { type: 'calendar', id };
    }
  }

  throw new InvalidActorUriError(
    'Actor URI path must contain /users/{id} or /calendars/{id}',
    uri,
  );
}

export function isPersonActorUri(uri: string): boolean {
  try {
    const parsed = parseActorUri(uri);
    return parsed.type === 'person';
  }
  catch {
    return false;
  }
}

export function isCalendarActorUri(uri: string): boolean {
  try {
    const parsed = parseActorUri(uri);
    return parsed.type === 'calendar';
  }
  catch {
    return false;
  }
}
