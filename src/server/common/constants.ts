/**
 * Federation Constants
 *
 * Shared constants used across federation-related operations.
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

/**
 * Response-body byte cap for a single fetched remote object (1 MiB).
 * `fetchRemoteObject` applies it whenever a caller omits `maxContentLength`;
 * the remote category proxy in the calendar domain applies it directly.
 *
 * SECURITY: the `fetchRemoteObject` path is reachable from an inbound
 * `Announce`, whose object URI is peer-controlled and whose fetched body is
 * normalized into an event row and rendered on a public calendar page. Without a default, a caller
 * that omits the option accepts a body of any size, and every new call site
 * would have to remember to pass one. A default makes an omitted option
 * bounded rather than unlimited; the explicit option remains an override.
 *
 * 1 MiB matches the cap already applied to the other outbound GETs
 * (`ACTOR_PROFILE_MAX_BYTES` for actor profiles, `MAX_PAGE_BYTES` for
 * backfill collection pages), so one number governs every peer-facing fetch.
 * It is an order of magnitude above the 100 KiB express.json default that
 * bounds an activity POSTed to the inbox — an embedded Event with several
 * languages of content and a few attachments is a few tens of KiB — while
 * still preventing a hostile peer from streaming an unbounded body into
 * memory.
 */
export const REMOTE_OBJECT_MAX_BYTES = 1_048_576;

/**
 * Maximum age for request Date header to prevent replay attacks (in milliseconds).
 *
 * 5 minutes tolerates clock skew between federated instances while still
 * preventing replay of captured signed requests. This is the standard
 * window used by most ActivityPub implementations.
 */
export const MAX_REQUEST_AGE_MS = 5 * 60 * 1000;
