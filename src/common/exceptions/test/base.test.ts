import { describe, it, expect } from 'vitest';

import { ValidationError } from '@/common/exceptions/base';

describe('ValidationError', () => {
  describe('constructor', () => {
    it('creates with a single string error', () => {
      const error = new ValidationError('Email is required');

      expect(error.message).toBe('Email is required');
      expect(error.errors).toEqual(['Email is required']);
      expect(error.name).toBe('ValidationError');
      expect(error.fields).toBeUndefined();
    });

    it('creates with an array of error messages', () => {
      const error = new ValidationError(['Email is required', 'Password too short']);

      expect(error.message).toBe('Email is required; Password too short');
      expect(error.errors).toEqual(['Email is required', 'Password too short']);
      expect(error.name).toBe('ValidationError');
      expect(error.fields).toBeUndefined();
    });

    it('creates with default message when no arguments provided', () => {
      const error = new ValidationError();

      expect(error.message).toBe('Validation failed');
      expect(error.errors).toEqual(['Validation failed']);
      expect(error.fields).toBeUndefined();
    });

    it('creates with field-level error mapping', () => {
      const fields = {
        email: ['Email is required', 'Email format invalid'],
        password: ['Too short'],
      };
      const error = new ValidationError('Validation failed', fields);

      expect(error.fields).toEqual(fields);
      expect(error.fields?.email).toEqual(['Email is required', 'Email format invalid']);
      expect(error.fields?.password).toEqual(['Too short']);
    });

    it('creates with field-level errors and array of messages', () => {
      const fields = { username: ['Username taken'] };
      const error = new ValidationError(['Invalid form', 'Check fields'], fields);

      expect(error.errors).toEqual(['Invalid form', 'Check fields']);
      expect(error.fields).toEqual(fields);
    });

    it('is an instance of Error', () => {
      const error = new ValidationError('test');
      expect(error).toBeInstanceOf(Error);
    });

    it('maintains proper prototype chain', () => {
      const error = new ValidationError('test');
      expect(error).toBeInstanceOf(ValidationError);
    });
  });

  describe('fields property', () => {
    it('is undefined when no fields provided', () => {
      const error = new ValidationError('error');
      expect(error.fields).toBeUndefined();
    });

    it('supports multiple errors per field', () => {
      const fields: Record<string, string[]> = {
        email: ['Invalid format', 'Already exists'],
        name: ['Too short'],
      };
      const error = new ValidationError('Validation failed', fields);

      expect(error.fields?.email).toHaveLength(2);
      expect(error.fields?.name).toHaveLength(1);
    });

    it('preserves field error arrays exactly', () => {
      const fieldErrors = ['Error one', 'Error two', 'Error three'];
      const error = new ValidationError('test', { myField: fieldErrors });

      expect(error.fields?.myField).toEqual(fieldErrors);
    });
  });
});
