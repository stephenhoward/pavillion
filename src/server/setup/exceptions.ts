class SetupAlreadyCompletedError extends Error {
  constructor() {
    super('Setup already completed');
  }
}

/**
 * The setup request did not carry the token issued at boot. Covers a missing,
 * wrong or retired token alike, so the response says nothing about which.
 */
class SetupTokenInvalidError extends Error {
  constructor() {
    super('Invalid setup token');
    this.name = 'SetupTokenInvalidError';
    Object.setPrototypeOf(this, SetupTokenInvalidError.prototype);
  }
}

export {
  SetupAlreadyCompletedError,
  SetupTokenInvalidError,
};
