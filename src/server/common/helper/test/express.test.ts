import { describe, it, expect } from 'vitest';
import sinon from 'sinon';

import { ValidationError } from '@/common/exceptions/base';
import expressHelper from '@/server/common/helper/express';

describe('sendValidationError', () => {
  it('includes error and errorName in response', () => {
    const error = new ValidationError('Email is required');
    const res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    expressHelper.sendValidationError(res as any, error);

    expect(res.status.calledWith(400)).toBe(true);
    const body = res.json.firstCall.args[0];
    expect(body.error).toBe('Email is required');
    expect(body.errorName).toBe('ValidationError');
  });

  it('omits fields property when no fields provided', () => {
    const error = new ValidationError('Something went wrong');
    const res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    expressHelper.sendValidationError(res as any, error);

    const body = res.json.firstCall.args[0];
    expect(body.fields).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(body, 'fields')).toBe(false);
  });

  it('includes fields in response when field-level errors are present', () => {
    const fields = {
      email: ['Email is required', 'Email format invalid'],
      password: ['Too short'],
    };
    const error = new ValidationError('Validation failed', fields);
    const res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    expressHelper.sendValidationError(res as any, error);

    const body = res.json.firstCall.args[0];
    expect(body.fields).toEqual(fields);
    expect(body.fields.email).toEqual(['Email is required', 'Email format invalid']);
    expect(body.fields.password).toEqual(['Too short']);
  });

  it('returns 400 status for all validation errors', () => {
    const error = new ValidationError('test');
    const res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    expressHelper.sendValidationError(res as any, error);

    expect(res.status.calledWith(400)).toBe(true);
  });

  it('response format matches expected shape with fields', () => {
    const fields = { email: ['Email is required'] };
    const error = new ValidationError('Validation failed', fields);
    const res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    expressHelper.sendValidationError(res as any, error);

    const body = res.json.firstCall.args[0];
    // Verify the exact response shape: { error, errorName, fields? }
    expect(body).toEqual({
      error: 'Validation failed',
      errorName: 'ValidationError',
      fields: { email: ['Email is required'] },
    });
  });

  it('response format matches expected shape without fields', () => {
    const error = new ValidationError('Simple error');
    const res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    expressHelper.sendValidationError(res as any, error);

    const body = res.json.firstCall.args[0];
    // Verify the exact response shape without fields
    expect(body).toEqual({
      error: 'Simple error',
      errorName: 'ValidationError',
    });
  });

  it('works with subclasses of ValidationError', () => {
    class CustomValidationError extends ValidationError {
      constructor(message: string) {
        super(message);
        this.name = 'CustomValidationError';
      }
    }

    const error = new CustomValidationError('Custom error');
    const res = { status: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    expressHelper.sendValidationError(res as any, error);

    const body = res.json.firstCall.args[0];
    expect(body.errorName).toBe('CustomValidationError');
    expect(body.error).toBe('Custom error');
  });
});
