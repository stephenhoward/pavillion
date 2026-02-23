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

export class DuplicateGrantError extends Error {
  constructor(accountId: string) {
    super(`An active grant already exists for account: ${accountId}`);
    this.name = 'DuplicateGrantError';
  }
}

export class GrantNotFoundError extends Error {
  constructor(grantId: string) {
    super(`Grant not found: ${grantId}`);
    this.name = 'GrantNotFoundError';
  }
}
