import type { FundingGatedFeature } from '@/common/model/funding-plan';

/**
 * Exception thrown when a calendar is determinately unfunded and the feature
 * it is reaching for is funding-gated.
 *
 * The feature is a FUNDING_GATED_FEATURES key rather than a free string
 * because it is wire-visible: it is echoed as the `feature` field of the 402
 * body that widget clients read. Typing it to the registry keeps the public
 * vocabulary and the registry from drifting apart.
 *
 * Named for the legacy wire contract, not for current terminology — DEC-007
 * settled on "funding plan", but `errorName: 'SubscriptionRequiredError'` and
 * the 402 status are what shipped clients already speak. Only the class name
 * is frozen; the human-readable message is not, and uses funding vocabulary.
 */
export class SubscriptionRequiredError extends Error {
  public readonly feature: FundingGatedFeature;

  constructor(feature: FundingGatedFeature) {
    super(`${feature} requires an active funding plan`);
    this.name = 'SubscriptionRequiredError';
    this.feature = feature;
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, SubscriptionRequiredError.prototype);
  }
}
