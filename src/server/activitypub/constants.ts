/**
 * ActivityPub Federation Constants
 *
 * Shared constants used across the ActivityPub federation implementation.
 */

/**
 * HTTP timeout for federation operations (in milliseconds).
 *
 * Used for:
 * - Fetching remote actor public keys
 * - WebFinger lookups
 * - Posting activities to remote inboxes
 * - Fetching remote actor profiles
 *
 * 15 seconds provides reasonable time for federation HTTP operations
 * while ensuring fast failure detection for unresponsive servers.
 */
export const FEDERATION_HTTP_TIMEOUT_MS = 15000;

/**
 * HTTP timeout for public key fetching (in milliseconds).
 *
 * Used when fetching public keys for HTTP signature verification.
 * Kept at 10 seconds for faster failure on signature verification.
 */
export const PUBLIC_KEY_FETCH_TIMEOUT_MS = 10000;

/**
 * HTTP timeout for fetching remote ActivityPub objects (in milliseconds).
 *
 * Used when fetching remote objects by URI (e.g., events, actors, activities).
 * Kept at 5 seconds for quick failure detection on object lookups.
 */
export const REMOTE_OBJECT_FETCH_TIMEOUT_MS = 5000;
