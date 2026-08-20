/**
 * Exception thrown when a feature requires an active funding plan.
 * The class name is frozen at the wire boundary (`errorName`) so existing
 * clients keep recognising the 402 response — see DEC-007. The
 * human-readable message is not frozen and uses funding vocabulary.
 */
export class SubscriptionRequiredError extends Error {
  public readonly feature: string;

  constructor(feature: string) {
    super(`${feature} requires an active funding plan`);
    this.name = 'SubscriptionRequiredError';
    this.feature = feature;
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, SubscriptionRequiredError.prototype);
  }
}
