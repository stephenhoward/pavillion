/**
 * Custom error class used to reject pending XHRs when the user dismisses the
 * session-expired modal. Callers (e.g. useEventEditor) can distinguish this
 * from other failures by checking `name === 'SessionExpiredError'`.
 */
export class SessionExpiredError extends Error {
  constructor(message: string = 'Session expired') {
    super(message);
    this.name = 'SessionExpiredError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, SessionExpiredError.prototype);
  }
}
