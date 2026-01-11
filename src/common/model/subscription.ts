import { PrimaryModel } from '@/common/model/model';

/**
 * Subscription status enum
 */
export type SubscriptionStatus = 'active' | 'past_due' | 'suspended' | 'cancelled';

/**
 * Billing cycle enum
 */
export type BillingCycle = 'monthly' | 'yearly';

/**
 * Payment provider type enum
 */
export type ProviderType = 'stripe' | 'paypal';

/**
 * Instance-wide subscription settings
 */
export class SubscriptionSettings extends PrimaryModel {
  enabled: boolean = false;
  monthlyPrice: number = 0; // in millicents
  yearlyPrice: number = 0; // in millicents
  currency: string = 'USD';
  payWhatYouCan: boolean = false;
  gracePeriodDays: number = 7;

  constructor(id?: string) {
    super(id);
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      enabled: this.enabled,
      monthlyPrice: this.monthlyPrice,
      yearlyPrice: this.yearlyPrice,
      currency: this.currency,
      payWhatYouCan: this.payWhatYouCan,
      gracePeriodDays: this.gracePeriodDays,
    };
  }

  static fromObject(obj: Record<string, any>): SubscriptionSettings {
    const settings = new SubscriptionSettings(obj.id);
    settings.enabled = obj.enabled ?? false;
    settings.monthlyPrice = obj.monthlyPrice ?? 0;
    settings.yearlyPrice = obj.yearlyPrice ?? 0;
    settings.currency = obj.currency ?? 'USD';
    settings.payWhatYouCan = obj.payWhatYouCan ?? false;
    settings.gracePeriodDays = obj.gracePeriodDays ?? 7;
    return settings;
  }

  clone(): SubscriptionSettings {
    return SubscriptionSettings.fromObject(this.toObject());
  }
}

/**
 * Payment provider configuration
 */
export class ProviderConfig extends PrimaryModel {
  providerType: ProviderType = 'stripe';
  enabled: boolean = false;
  displayName: string = '';
  credentials: string = '{}'; // JSON string of encrypted credentials
  webhookSecret: string = '';

  constructor(id?: string, providerType?: ProviderType) {
    super(id);
    if (providerType) {
      this.providerType = providerType;
    }
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      providerType: this.providerType,
      enabled: this.enabled,
      displayName: this.displayName,
      credentials: this.credentials,
      webhookSecret: this.webhookSecret,
    };
  }

  static fromObject(obj: Record<string, any>): ProviderConfig {
    const config = new ProviderConfig(obj.id, obj.providerType);
    config.enabled = obj.enabled ?? false;
    config.displayName = obj.displayName ?? '';
    config.credentials = obj.credentials ?? '{}';
    config.webhookSecret = obj.webhookSecret ?? '';
    return config;
  }

  clone(): ProviderConfig {
    return ProviderConfig.fromObject(this.toObject());
  }
}

/**
 * User subscription
 */
export class Subscription extends PrimaryModel {
  accountId: string = '';
  providerConfigId: string = '';
  providerSubscriptionId: string = '';
  providerCustomerId: string = '';
  status: SubscriptionStatus = 'active';
  billingCycle: BillingCycle = 'monthly';
  amount: number = 0; // in millicents
  currency: string = 'USD';
  currentPeriodStart: Date | null = null;
  currentPeriodEnd: Date | null = null;
  cancelledAt: Date | null = null;
  suspendedAt: Date | null = null;

  constructor(id?: string) {
    super(id);
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      accountId: this.accountId,
      providerConfigId: this.providerConfigId,
      providerSubscriptionId: this.providerSubscriptionId,
      providerCustomerId: this.providerCustomerId,
      status: this.status,
      billingCycle: this.billingCycle,
      amount: this.amount,
      currency: this.currency,
      currentPeriodStart: this.currentPeriodStart,
      currentPeriodEnd: this.currentPeriodEnd,
      cancelledAt: this.cancelledAt,
      suspendedAt: this.suspendedAt,
    };
  }

  static fromObject(obj: Record<string, any>): Subscription {
    const subscription = new Subscription(obj.id);
    subscription.accountId = obj.accountId ?? '';
    subscription.providerConfigId = obj.providerConfigId ?? '';
    subscription.providerSubscriptionId = obj.providerSubscriptionId ?? '';
    subscription.providerCustomerId = obj.providerCustomerId ?? '';
    subscription.status = obj.status ?? 'active';
    subscription.billingCycle = obj.billingCycle ?? 'monthly';
    subscription.amount = obj.amount ?? 0;
    subscription.currency = obj.currency ?? 'USD';
    subscription.currentPeriodStart = obj.currentPeriodStart ? new Date(obj.currentPeriodStart) : null;
    subscription.currentPeriodEnd = obj.currentPeriodEnd ? new Date(obj.currentPeriodEnd) : null;
    subscription.cancelledAt = obj.cancelledAt ? new Date(obj.cancelledAt) : null;
    subscription.suspendedAt = obj.suspendedAt ? new Date(obj.suspendedAt) : null;
    return subscription;
  }

  clone(): Subscription {
    return Subscription.fromObject(this.toObject());
  }
}

/**
 * Subscription event audit log
 */
export class SubscriptionEvent extends PrimaryModel {
  subscriptionId: string = '';
  eventType: string = '';
  providerEventId: string = '';
  payload: string = '{}'; // JSON string
  processedAt: Date | null = null;

  constructor(id?: string) {
    super(id);
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      subscriptionId: this.subscriptionId,
      eventType: this.eventType,
      providerEventId: this.providerEventId,
      payload: this.payload,
      processedAt: this.processedAt,
    };
  }

  static fromObject(obj: Record<string, any>): SubscriptionEvent {
    const event = new SubscriptionEvent(obj.id);
    event.subscriptionId = obj.subscriptionId ?? '';
    event.eventType = obj.eventType ?? '';
    event.providerEventId = obj.providerEventId ?? '';
    event.payload = obj.payload ?? '{}';
    event.processedAt = obj.processedAt ? new Date(obj.processedAt) : null;
    return event;
  }

  clone(): SubscriptionEvent {
    return SubscriptionEvent.fromObject(this.toObject());
  }
}

/**
 * Convert millicents to display amount (for 2-decimal currencies)
 *
 * @param millicents - Amount in millicents
 * @returns Formatted string with 2 decimal places
 */
export function millicentsToDisplay(millicents: number): string {
  return (millicents / 100000).toFixed(2);
}

/**
 * Convert display amount to millicents (for 2-decimal currencies)
 *
 * @param amount - Amount as string or number
 * @returns Amount in millicents
 */
export function displayToMillicents(amount: string | number): number {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  return Math.round(numAmount * 100000);
}
