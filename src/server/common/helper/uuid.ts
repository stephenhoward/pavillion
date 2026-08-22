/**
 * UUID predicates. Two intentionally different dialects live here — pick by
 * what the call site is asking:
 *
 * - `isValidUuidV4` — identity validation. Every id Pavillion mints is a v4
 *   UUID, so anything that names a local row (route params, service
 *   arguments, DTO fields) must pass this.
 * - `looksLikeUuid` — shape detection. Answers "is this a UUID at all, or an
 *   ActivityPub URL / other non-UUID string?" before a value reaches a
 *   Sequelize UUID column. Deliberately accepts any version/variant because
 *   the input may originate from a federated peer; do not use it to validate
 *   a local identifier.
 */

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_SHAPE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Strict RFC 4122 v4 check. Takes `unknown` and narrows to `string` so it can
 * guard route parameters, which Express types as `string | string[]`.
 */
export function isValidUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_REGEX.test(value);
}

/**
 * Permissive 8-4-4-4-12 hex shape check, any version or variant. Use to
 * distinguish a UUID from an AP URL, never to validate identity.
 */
export function looksLikeUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_SHAPE_REGEX.test(value);
}
