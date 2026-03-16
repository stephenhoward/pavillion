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

export class SubscriptionNotFoundError extends Error {
  constructor(subscriptionId: string) {
    super(`Funding plan not found: ${subscriptionId}`);
    this.name = 'SubscriptionNotFoundError';
    Object.setPrototypeOf(this, SubscriptionNotFoundError.prototype);
  }
}

export class CalendarSubscriptionNotFoundError extends Error {
  constructor(subscriptionId: string, calendarId: string) {
    super(`No active calendar subscription found for subscription ${subscriptionId} and calendar ${calendarId}`);
    this.name = 'CalendarSubscriptionNotFoundError';
    Object.setPrototypeOf(this, CalendarSubscriptionNotFoundError.prototype);
  }
}

export class DuplicateCalendarSubscriptionError extends Error {
  constructor(subscriptionId: string, calendarId: string) {
    super(`An active calendar subscription already exists for subscription ${subscriptionId} and calendar ${calendarId}`);
    this.name = 'DuplicateCalendarSubscriptionError';
    Object.setPrototypeOf(this, DuplicateCalendarSubscriptionError.prototype);
  }
}
