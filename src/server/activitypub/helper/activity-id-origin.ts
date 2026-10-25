/**
 * Activity-id ownership: an inbound activity's `id` must be on the host that
 * authenticated it.
 *
 * `ap_inbox` is keyed on the activity id, first writer wins, and Delete/Undo
 * ids are deterministic (`{objectUrl}/delete`, `{targetId}/undo`). The
 * signature gate binds `actor` to the signing key but not `id`, so without
 * this check any peer with a valid key could store an activity under another
 * host's id and cause that host's genuine activity to be skipped as a
 * duplicate.
 *
 * The comparison keys on the verified origin (`InboxAuthContext.origin`),
 * never on a host derived from the self-asserted `actor` (DEC-013).
 */

/**
 * Raised when an inbound activity's id is not on its verified origin, or the
 * origin is unknown. Callers refuse the activity and write no inbox row.
 */
export class ActivityIdOriginMismatchError extends Error {
  constructor(message: string = 'Activity id is not on the origin that authenticated it') {
    super(message);
    this.name = 'ActivityIdOriginMismatchError';
    Object.setPrototypeOf(this, ActivityIdOriginMismatchError.prototype);
  }
}

/**
 * Whether an activity id is on the verified origin's host. Compares
 * `new URL(...).host` (port-significant), as the Undo ownership gates do, and
 * fails closed: a null origin or an unparseable id or origin is a mismatch.
 *
 * @param activityId - The inbound activity's `id`
 * @param origin - The verified origin (scheme + host), or null when unknown
 * @returns True only when both parse and their hosts are equal
 */
export function isActivityIdOnOrigin(activityId: string, origin: string | null): boolean {
  if (!origin) {
    return false;
  }
  try {
    return new URL(activityId).host === new URL(origin).host;
  }
  catch {
    return false;
  }
}
