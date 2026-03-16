import { PrimaryModel } from '@/common/model/model';

/**
 * Funding plan status enum
 */
export type FundingPlanStatus = 'active' | 'past_due' | 'suspended' | 'cancelled';

/**
 * Billing cycle enum
 */
export type BillingCycle = 'monthly' | 'yearly';

/**
 * Payment provider type enum
 */
export type ProviderType = 'stripe' | 'paypal';

/**
 * Calendar funding status for UI display
 */
export type FundingStatus = 'admin-exempt' | 'grant' | 'funded' | 'unfunded';

/**
 * Instance-wide funding settings
 */
export class FundingSettings extends PrimaryModel {
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

  static fromObject(obj: Record<string, any>): FundingSettings {
    const settings = new FundingSettings(obj.id);
    settings.enabled = obj.enabled ?? false;
    settings.monthlyPrice = obj.monthlyPrice ?? 0;
    settings.yearlyPrice = obj.yearlyPrice ?? 0;
    settings.currency = obj.currency ?? 'USD';
    settings.payWhatYouCan = obj.payWhatYouCan ?? false;
    settings.gracePeriodDays = obj.gracePeriodDays ?? 7;
    return settings;
  }

  clone(): FundingSettings {
    return FundingSettings.fromObject(this.toObject());
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
 * User funding plan
 */
export class FundingPlan extends PrimaryModel {
  accountId: string = '';
  providerConfigId: string = '';
  providerSubscriptionId: string = '';
  providerCustomerId: string = '';
  status: FundingPlanStatus = 'active';
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

  static fromObject(obj: Record<string, any>): FundingPlan {
    const plan = new FundingPlan(obj.id);
    plan.accountId = obj.accountId ?? '';
    plan.providerConfigId = obj.providerConfigId ?? '';
    plan.providerSubscriptionId = obj.providerSubscriptionId ?? '';
    plan.providerCustomerId = obj.providerCustomerId ?? '';
    plan.status = obj.status ?? 'active';
    plan.billingCycle = obj.billingCycle ?? 'monthly';
    plan.amount = obj.amount ?? 0;
    plan.currency = obj.currency ?? 'USD';
    plan.currentPeriodStart = obj.currentPeriodStart ? new Date(obj.currentPeriodStart) : null;
    plan.currentPeriodEnd = obj.currentPeriodEnd ? new Date(obj.currentPeriodEnd) : null;
    plan.cancelledAt = obj.cancelledAt ? new Date(obj.cancelledAt) : null;
    plan.suspendedAt = obj.suspendedAt ? new Date(obj.suspendedAt) : null;
    return plan;
  }

  clone(): FundingPlan {
    return FundingPlan.fromObject(this.toObject());
  }
}

/**
 * Funding event audit log
 */
export class FundingEvent extends PrimaryModel {
  fundingPlanId: string = '';
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
      fundingPlanId: this.fundingPlanId,
      eventType: this.eventType,
      providerEventId: this.providerEventId,
      payload: this.payload,
      processedAt: this.processedAt,
    };
  }

  static fromObject(obj: Record<string, any>): FundingEvent {
    const event = new FundingEvent(obj.id);
    event.fundingPlanId = obj.fundingPlanId ?? '';
    event.eventType = obj.eventType ?? '';
    event.providerEventId = obj.providerEventId ?? '';
    event.payload = obj.payload ?? '{}';
    event.processedAt = obj.processedAt ? new Date(obj.processedAt) : null;
    return event;
  }

  clone(): FundingEvent {
    return FundingEvent.fromObject(this.toObject());
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
