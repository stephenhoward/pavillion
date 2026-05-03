/**
 * Validation Decorators
 *
 * Property decorators for common validation patterns.
 * Decorators attach metadata to class properties; call `validate(instance)` to
 * run all attached rules and collect field-level errors.
 *
 * @example
 * class CreateUserInput {
 *   @Required()
 *   @Email()
 *   email: string = '';
 *
 *   @Required()
 *   @MinLength(8)
 *   @MaxLength(100)
 *   password: string = '';
 *
 *   @UUID()
 *   calendarId: string = '';
 * }
 *
 * const input = new CreateUserInput();
 * input.email = 'not-an-email';
 * input.password = 'short';
 *
 * const errors = validate(input);
 * // errors => { email: ['must be a valid email address'], password: ['must be at least 8 characters'] }
 *
 * if (Object.keys(errors).length > 0) {
 *   throw new ValidationError('Validation failed', errors);
 * }
 */

import { ValidationError } from '@/common/exceptions/base';

// ------------------------------------------------------------------
// Internal metadata registry
// ------------------------------------------------------------------

/** A single validation rule attached to one property. */
interface ValidationRule {
  /** Human-readable name of the rule, e.g. 'required'. */
  rule: string;
  /** Validates the raw value; returns an error message or null. */
  check: (value: unknown) => string | null;
}

const RULES_KEY = Symbol('validation:rules');

/**
 * Retrieve the list of rules stored on a prototype for a given property.
 * Creates the array on first access.
 */
function getRules(target: object, propertyKey: string): ValidationRule[] {
  const map: Map<string, ValidationRule[]> = (target as Record<symbol, unknown>)[RULES_KEY] as Map<string, ValidationRule[]> ?? new Map();
  (target as Record<symbol, unknown>)[RULES_KEY] = map;
  if (!map.has(propertyKey)) {
    map.set(propertyKey, []);
  }
  return map.get(propertyKey)!;
}

/**
 * Attach a validation rule to a property via a property decorator.
 */
function addRule(rule: ValidationRule) {
  return function (target: object, propertyKey: string): void {
    getRules(target, propertyKey).push(rule);
  };
}

// ------------------------------------------------------------------
// Decorators
// ------------------------------------------------------------------

/**
 * Marks a field as required. Validation fails when the value is `null`,
 * `undefined`, or an empty string (after trimming).
 *
 * @example
 * @Required()
 * name: string = '';
 */
export function Required() {
  return addRule({
    rule: 'required',
    check(value: unknown): string | null {
      if (value === null || value === undefined) {
        return 'is required';
      }
      if (typeof value === 'string' && value.trim() === '') {
        return 'is required';
      }
      return null;
    },
  });
}

/**
 * Validates that a field contains a valid RFC 5322-compatible email address.
 * Empty / absent values are allowed — combine with `@Required()` to enforce
 * presence.
 *
 * @example
 * @Required()
 * @Email()
 * email: string = '';
 */
export function Email() {
  // Matches most valid email addresses while rejecting obvious typos.
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return addRule({
    rule: 'email',
    check(value: unknown): string | null {
      if (value === null || value === undefined || value === '') {
        return null; // absence is handled by @Required
      }
      if (typeof value !== 'string' || !EMAIL_REGEX.test(value)) {
        return 'must be a valid email address';
      }
      return null;
    },
  });
}

/**
 * Validates that a field contains a valid UUID (v1–v5, case-insensitive).
 * Empty / absent values are allowed — combine with `@Required()` to enforce
 * presence.
 *
 * @example
 * @UUID()
 * calendarId: string = '';
 */
export function UUID() {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return addRule({
    rule: 'uuid',
    check(value: unknown): string | null {
      if (value === null || value === undefined || value === '') {
        return null; // absence is handled by @Required
      }
      if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
        return 'must be a valid UUID';
      }
      return null;
    },
  });
}

/**
 * Validates that a string field has at least `min` characters.
 * Empty / absent values are skipped — combine with `@Required()` to enforce
 * presence.
 *
 * @param min - Minimum number of characters (inclusive).
 *
 * @example
 * @Required()
 * @MinLength(8)
 * password: string = '';
 */
export function MinLength(min: number) {
  return addRule({
    rule: 'minLength',
    check(value: unknown): string | null {
      if (value === null || value === undefined || value === '') {
        return null; // absence is handled by @Required
      }
      if (typeof value !== 'string' || value.length < min) {
        return `must be at least ${min} character${min === 1 ? '' : 's'}`;
      }
      return null;
    },
  });
}

/**
 * Validates that a string field has no more than `max` characters.
 * Empty / absent values are skipped — combine with `@Required()` to enforce
 * presence.
 *
 * @param max - Maximum number of characters (inclusive).
 *
 * @example
 * @MaxLength(100)
 * name: string = '';
 */
export function MaxLength(max: number) {
  return addRule({
    rule: 'maxLength',
    check(value: unknown): string | null {
      if (value === null || value === undefined || value === '') {
        return null; // absence is handled by @Required
      }
      if (typeof value !== 'string' || value.length > max) {
        return `must be at most ${max} character${max === 1 ? '' : 's'}`;
      }
      return null;
    },
  });
}

// ------------------------------------------------------------------
// Validation runner
// ------------------------------------------------------------------

/**
 * Run all decorator-attached validation rules on `instance` and return a
 * field-keyed error map.  An empty map means the object is valid.
 *
 * @param instance - An instance of any class decorated with validation rules.
 * @returns A map of `{ fieldName: string[] }` containing error messages.
 *
 * @example
 * const errors = validate(input);
 * if (Object.keys(errors).length > 0) {
 *   throw new ValidationError('Validation failed', errors);
 * }
 */
export function validate(instance: object): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  const proto = Object.getPrototypeOf(instance) as Record<symbol, unknown>;
  const rulesMap = proto[RULES_KEY] as Map<string, ValidationRule[]> | undefined;

  if (!rulesMap) {
    return result;
  }

  for (const [field, rules] of rulesMap.entries()) {
    const value = (instance as Record<string, unknown>)[field];
    const fieldErrors: string[] = [];

    for (const rule of rules) {
      const message = rule.check(value);
      if (message !== null) {
        fieldErrors.push(message);
      }
    }

    if (fieldErrors.length > 0) {
      result[field] = fieldErrors;
    }
  }

  return result;
}

/**
 * Convenience wrapper: run `validate()` and throw a `ValidationError` if any
 * errors are found.  Callers that want fine-grained control should use
 * `validate()` directly.
 *
 * @param instance - An instance of any class decorated with validation rules.
 * @throws {ValidationError} when one or more fields fail validation.
 *
 * @example
 * validateOrThrow(input); // throws if invalid
 */
export function validateOrThrow(instance: object): void {
  const errors = validate(instance);
  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Validation failed', errors);
  }
}
