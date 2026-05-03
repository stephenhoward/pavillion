import { describe, it, expect } from 'vitest';
import { handleApiError } from '@/client/service/utils';
import { ValidationError, UnknownError } from '@/common/exceptions/base';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';

const errorMap = {
  CalendarNotFoundError,
  UnknownError,
};

function makeAxiosError(data: Record<string, unknown>) {
  return { response: { data } };
}

describe('handleApiError', () => {
  it('throws UnknownError for non-axios errors', () => {
    expect(() => handleApiError(new Error('generic'), errorMap)).toThrow(UnknownError);
  });

  it('throws UnknownError when errorName is not in map', () => {
    const error = makeAxiosError({ errorName: 'SomeOtherError' });
    expect(() => handleApiError(error, errorMap)).toThrow(UnknownError);
  });

  it('throws the mapped error class when errorName matches', () => {
    const error = makeAxiosError({ errorName: 'CalendarNotFoundError' });
    expect(() => handleApiError(error, errorMap)).toThrow(CalendarNotFoundError);
  });

  describe('ValidationError with fields', () => {
    it('throws ValidationError with the server error message', () => {
      const error = makeAxiosError({
        errorName: 'ValidationError',
        error: 'Validation failed',
      });
      let thrown: ValidationError | undefined;
      try {
        handleApiError(error, { ValidationError, UnknownError });
      }
      catch (e) {
        thrown = e as ValidationError;
      }
      expect(thrown).toBeInstanceOf(ValidationError);
      expect(thrown?.message).toBe('Validation failed');
    });

    it('throws ValidationError with fields map when backend supplies fields', () => {
      const fields = {
        email: ['Email is required'],
        password: ['Password must be at least 8 characters'],
      };
      const error = makeAxiosError({
        errorName: 'ValidationError',
        error: 'Validation failed',
        fields,
      });
      let thrown: ValidationError | undefined;
      try {
        handleApiError(error, { ValidationError, UnknownError });
      }
      catch (e) {
        thrown = e as ValidationError;
      }
      expect(thrown).toBeInstanceOf(ValidationError);
      expect(thrown?.fields).toEqual(fields);
    });

    it('throws ValidationError with no fields when backend omits fields', () => {
      const error = makeAxiosError({
        errorName: 'ValidationError',
        error: 'Validation failed',
      });
      let thrown: ValidationError | undefined;
      try {
        handleApiError(error, { ValidationError, UnknownError });
      }
      catch (e) {
        thrown = e as ValidationError;
      }
      expect(thrown).toBeInstanceOf(ValidationError);
      expect(thrown?.fields).toBeUndefined();
    });

    it('uses default message when backend omits error string', () => {
      const error = makeAxiosError({ errorName: 'ValidationError' });
      let thrown: ValidationError | undefined;
      try {
        handleApiError(error, { ValidationError, UnknownError });
      }
      catch (e) {
        thrown = e as ValidationError;
      }
      expect(thrown).toBeInstanceOf(ValidationError);
      expect(thrown?.message).toBe('Validation failed');
    });
  });
});
