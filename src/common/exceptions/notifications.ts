/**
 * Thrown when a recipient row is not found for the calling account.
 *
 * The PATCH /api/v1/notification/:id handler returns 404 (not 403) when
 * a recipient belongs to another account: leaking "this id exists but
 * isn't yours" would enable cross-account notification id enumeration.
 * The route handler maps this exception to a 404 response with the same
 * shape used for genuinely-missing ids.
 */
export class NotificationRecipientNotFoundError extends Error {
  constructor(message: string = 'Notification not found') {
    super(message);
    this.name = 'NotificationRecipientNotFoundError';
    Object.setPrototypeOf(this, NotificationRecipientNotFoundError.prototype);
  }
}
