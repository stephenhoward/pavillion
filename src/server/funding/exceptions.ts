import { ValidationError } from '@/common/exceptions/base';

export class InvalidBillingCycleError extends ValidationError {
  constructor(message?: string) {
    super(message || 'Invalid billing cycle. Must be "monthly" or "yearly"');
    this.name = 'InvalidBillingCycleError';
  }
}

export class InvalidProviderTypeError extends ValidationError {
  constructor(message?: string) {
    super(message || 'Invalid provider type. Must be "stripe" or "paypal"');
    this.name = 'InvalidProviderTypeError';
  }
}

export class InvalidAmountError extends ValidationError {
  constructor(message?: string) {
    super(message || 'Invalid amount. Must be a non-negative number');
    this.name = 'InvalidAmountError';
  }
}

export class MissingRequiredFieldError extends ValidationError {
  constructor(fieldName: string) {
    super(`Missing required field: ${fieldName}`);
    this.name = 'MissingRequiredFieldError';
  }
}

export class InvalidCurrencyError extends ValidationError {
  constructor(message?: string) {
    super(message || 'Invalid currency. Must be a 3-letter ISO 4217 code');
    this.name = 'InvalidCurrencyError';
  }
}

export class InvalidCredentialsError extends ValidationError {
  constructor(message?: string) {
    super(message || 'Invalid credentials provided');
    this.name = 'InvalidCredentialsError';
  }
}

export class InvalidEnvironmentError extends ValidationError {
  constructor(message?: string) {
    super(message || 'Invalid environment. Must be "sandbox" or "production"');
    this.name = 'InvalidEnvironmentError';
  }
}

export class AccountNotFoundError extends Error {
  constructor(accountId: string) {
    super(`Account not found: ${accountId}`);
    this.name = 'AccountNotFoundError';
  }
}

export class CalendarNotFoundError extends Error {
  constructor(calendarId: string) {
    super(`Calendar not found: ${calendarId}`);
    this.name = 'CalendarNotFoundError';
  }
}

export class DuplicateGrantError extends Error {
  constructor(calendarId: string) {
    super(`An active grant already exists for calendar: ${calendarId}`);
    this.name = 'DuplicateGrantError';
  }
}

export class GrantNotFoundError extends Error {
  constructor(grantId: string) {
    super(`Grant not found: ${grantId}`);
    this.name = 'GrantNotFoundError';
  }
}

export class FundingPlanNotFoundError extends Error {
  constructor(fundingPlanId: string) {
    super(`Funding plan not found: ${fundingPlanId}`);
    this.name = 'FundingPlanNotFoundError';
    Object.setPrototypeOf(this, FundingPlanNotFoundError.prototype);
  }
}

export class CalendarFundingPlanNotFoundError extends Error {
  constructor(fundingPlanId: string, calendarId: string) {
    super(`No active calendar funding plan found for funding plan ${fundingPlanId} and calendar ${calendarId}`);
    this.name = 'CalendarFundingPlanNotFoundError';
    Object.setPrototypeOf(this, CalendarFundingPlanNotFoundError.prototype);
  }
}

export class DuplicateCalendarFundingPlanError extends Error {
  constructor(fundingPlanId: string, calendarId: string) {
    super(`An active calendar funding plan already exists for funding plan ${fundingPlanId} and calendar ${calendarId}`);
    this.name = 'DuplicateCalendarFundingPlanError';
    Object.setPrototypeOf(this, DuplicateCalendarFundingPlanError.prototype);
  }
}

export class ActiveFundingPlanExistsError extends Error {
  constructor(accountId: string) {
    super(`Account ${accountId} already has an active funding plan`);
    this.name = 'ActiveFundingPlanExistsError';
    Object.setPrototypeOf(this, ActiveFundingPlanExistsError.prototype);
  }
}

export class ProviderNotConfiguredError extends Error {
  constructor(message?: string) {
    super(message || 'No Stripe provider configured or enabled');
    this.name = 'ProviderNotConfiguredError';
    Object.setPrototypeOf(this, ProviderNotConfiguredError.prototype);
  }
}

export class InvalidSessionIdError extends ValidationError {
  constructor(message?: string) {
    super(message || 'Invalid session ID format');
    this.name = 'InvalidSessionIdError';
    Object.setPrototypeOf(this, InvalidSessionIdError.prototype);
  }
}

export class WebhookSignatureError extends Error {
  constructor(message?: string) {
    super(message || 'Webhook signature verification failed');
    this.name = 'WebhookSignatureError';
    Object.setPrototypeOf(this, WebhookSignatureError.prototype);
  }
}
