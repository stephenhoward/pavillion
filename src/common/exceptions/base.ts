/**
 * Custom error class for unauthenticated access attempts
 */
export class UnauthenticatedError extends Error {
  constructor(message: string = 'Authentication required') {
    super(message);
    this.name = 'UnauthenticatedError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, UnauthenticatedError.prototype);
  }
}

/**
 * Custom error class for unknown errors
 */
export class UnknownError extends Error {
  constructor(message: string = 'Unknown error occurred') {
    super(message);
    this.name = 'UnknownError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, UnknownError.prototype);
  }
}

/**
 * Custom error class for empty values
 */
export class EmptyValueError extends Error {
  constructor(message: string = 'Empty value provided') {
    super(message);
    this.name = 'EmptyValueError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, EmptyValueError.prototype);
  }
}

/**
 * Custom error class for duplicate account invitations
 */
export class AccountInviteAlreadyExistsError extends Error {
  constructor(message: string = 'An invitation has already been sent to this email address') {
    super(message);
    this.name = 'AccountInviteAlreadyExistsError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, AccountInviteAlreadyExistsError.prototype);
  }
}

/**
 * Base validation error class for validation failures.
 * Supports multiple error messages and optional field-level error mapping.
 *
 * @example
 * // Single error message
 * throw new ValidationError('Email is required');
 *
 * @example
 * // Multiple error messages
 * throw new ValidationError(['Email is required', 'Password too short']);
 *
 * @example
 * // With field-level validation errors
 * throw new ValidationError('Validation failed', {
 *   email: ['Invalid format', 'Already exists'],
 *   password: ['Too short']
 * });
 */
export class ValidationError extends Error {
  public errors: string[];
  public fields?: Record<string, string[]>;

  constructor(errors: string | string[], fields?: Record<string, string[]>) {
    const errorArray = typeof errors === 'string' ? [errors] : errors;
    super(errorArray.join('; '));
    this.name = 'ValidationError';
    this.errors = errorArray;
    this.fields = fields;
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
