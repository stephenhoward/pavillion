import { describe, it, expect } from 'vitest';

import { ValidationError } from '@/common/exceptions/base';
import * as fundingExceptions from '@/common/exceptions/funding';

describe('funding exceptions', () => {
  describe('ValidationError subclass prototype chain', () => {
    // Sweep every exported ValidationError subclass so a newly added
    // subclass cannot silently regress the instanceof check.
    const validationErrorSubclasses = Object.entries(fundingExceptions).filter(
      (entry): entry is [string, new (message: string) => ValidationError] => {
        const exported = entry[1];
        return (
          typeof exported === 'function'
          && exported.prototype instanceof ValidationError
        );
      },
    );

    it('exports ValidationError subclasses', () => {
      const names = validationErrorSubclasses.map(([name]) => name);
      expect(names).toEqual(expect.arrayContaining([
        'InvalidBillingCycleError',
        'InvalidProviderTypeError',
        'InvalidAmountError',
        'MissingRequiredFieldError',
        'InvalidCurrencyError',
        'InvalidCredentialsError',
        'InvalidEnvironmentError',
        'InvalidSessionIdError',
      ]));
    });

    it.each(validationErrorSubclasses)(
      '%s instances pass their own instanceof check',
      (name, SubclassError) => {
        const error = new SubclassError('test message');

        expect(error).toBeInstanceOf(SubclassError);
        expect(error).toBeInstanceOf(ValidationError);
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe(name);
      },
    );
  });
});
