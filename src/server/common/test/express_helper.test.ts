import { describe, it, expect, afterEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import expressHelper from '@/server/common/helper/express';

describe('adminOnly', async () => {
  let sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail on missing user', async () => {

    let req = { user: null };
    let res = { status: sinon.stub(), json: sinon.stub() };
    let next = sinon.stub();
    res.status.returns(res);

    await expressHelper.adminOnly[1](req,res,next);

    expect(res.status.calledWith(403)).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should fail on not-admin', async () => {

    let req = { user: new Account('testUser') };
    let res = { status: sinon.stub(), json: sinon.stub() };
    let next = sinon.stub();
    res.status.returns(res);

    await expressHelper.adminOnly[1](req,res,next);

    expect(res.status.calledWith(403)).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should succeed on admin', async () => {

    let req = { user: new Account('testUser') };
    let res = { status: sinon.stub(), json: sinon.stub() };
    let next = sinon.stub();

    req.user.roles = ['admin'];
    res.status.returns(res);

    await expressHelper.adminOnly[1](req,res,next);

    expect(res.status.called).toBe(false);
    expect(next.called).toBe(true);
  });
});

describe('noUserOnly', async () => {
  let sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail on user present', async () => {

    let req = { user: new Account('testUser') };
    let res = { status: sinon.stub(), json: sinon.stub() };
    let next = sinon.stub();
    res.status.returns(res);

    await expressHelper.noUserOnly[0](req,res,next);

    expect(res.status.calledWith(403)).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should succeed on user missing', async () => {

    let req = { user: null };
    let res = { status: sinon.stub(), json: sinon.stub() };
    let next = sinon.stub();

    res.status.returns(res);

    await expressHelper.noUserOnly[0](req,res,next);

    expect(res.status.called).toBe(false);
    expect(next.called).toBe(true);
  });
});

describe('loggedInOnly', async () => {
  let sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail on missing user', async () => {

    let req = { user: null };
    let res = { status: sinon.stub(), json: sinon.stub() };
    let next = sinon.stub();
    res.status.returns(res);

    await expressHelper.loggedInOnly[1](req,res,next);

    expect(res.status.calledWith(403)).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should succeed on user present', async () => {

    let req = { user: new Account('testUser') };
    let res = { status: sinon.stub(), json: sinon.stub() };
    let next = sinon.stub();

    res.status.returns(res);

    await expressHelper.loggedInOnly[1](req,res,next);

    expect(res.status.called).toBe(false);
    expect(next.called).toBe(true);
  });
});

describe('generateJWT', async () => {
  it('should generate an admin token', async () => {
    let account = new Account('testUser');
    account.roles = ['admin'];

    let token = expressHelper.generateJWT(account);
    let payload = JSON.parse(
      atob( token.split('.')[1].replace('-','+').replace('_','/') ),
    );

    expect(token).not.toBe(null);
    expect(payload.id).toBe(account.id);
    expect(payload.isAdmin).toBe(true);
    expect(payload.exp).toBeDefined();
  });

  it('should generate an non admin token', async () => {
    let account = new Account('testUser');

    let token = expressHelper.generateJWT(account);
    let payload = JSON.parse(
      atob( token.split('.')[1].replace('-','+').replace('_','/') ),
    );

    expect(token).not.toBe(null);
    expect(payload.id).toBe(account.id);
    expect(payload.isAdmin).toBe(false);
    expect(payload.exp).toBeDefined();
  });
});

describe('isValidUUID', () => {
  it('should validate correct UUID v4', () => {
    expect(expressHelper.isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(expressHelper.isValidUUID('c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd')).toBe(true);
    expect(expressHelper.isValidUUID('C73BCDCC-2669-4BF6-81D3-E4AE73FB11FD')).toBe(true); // uppercase
  });

  it('should reject invalid UUIDs', () => {
    expect(expressHelper.isValidUUID('not-a-uuid')).toBe(false);
    expect(expressHelper.isValidUUID('12345')).toBe(false);
    expect(expressHelper.isValidUUID('')).toBe(false);
    expect(expressHelper.isValidUUID('550e8400-e29b-41d4-a716-44665544000')).toBe(false); // too short
    expect(expressHelper.isValidUUID('550e8400-e29b-41d4-a716-4466554400000')).toBe(false); // too long
    expect(expressHelper.isValidUUID('550e8400-e29b-31d4-a716-446655440000')).toBe(false); // not v4 (wrong version digit)
  });

  it('should reject non-string values', () => {
    expect(expressHelper.isValidUUID(null as any)).toBe(false);
    expect(expressHelper.isValidUUID(undefined as any)).toBe(false);
    expect(expressHelper.isValidUUID(123 as any)).toBe(false);
    expect(expressHelper.isValidUUID({} as any)).toBe(false);
  });
});

describe('findInvalidUUIDs', () => {
  it('should return empty array for all valid UUIDs', () => {
    const uuids = [
      '550e8400-e29b-41d4-a716-446655440000',
      'c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd',
    ];
    expect(expressHelper.findInvalidUUIDs(uuids)).toEqual([]);
  });

  it('should return all invalid UUIDs', () => {
    const uuids = ['not-a-uuid', '12345', 'also-invalid'];
    expect(expressHelper.findInvalidUUIDs(uuids)).toEqual(['not-a-uuid', '12345', 'also-invalid']);
  });

  it('should return only invalid UUIDs from mixed array', () => {
    const uuids = [
      '550e8400-e29b-41d4-a716-446655440000',
      'invalid-uuid',
      'c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd',
      'bad-one',
    ];
    expect(expressHelper.findInvalidUUIDs(uuids)).toEqual(['invalid-uuid', 'bad-one']);
  });

  it('should handle empty array', () => {
    expect(expressHelper.findInvalidUUIDs([])).toEqual([]);
  });
});
