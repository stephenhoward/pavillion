/**
 * Exception thrown when a feature requires an active subscription
 */
export class SubscriptionRequiredError extends Error {
  public readonly feature: string;

  constructor(feature: string) {
    super(`${feature} requires an active subscription`);
    this.name = 'SubscriptionRequiredError';
    this.feature = feature;
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, SubscriptionRequiredError.prototype);
  }
}
