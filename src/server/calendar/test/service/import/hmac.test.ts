import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import config from 'config';
import crypto from 'crypto';

import {
  getImportHmacSecret,
  generateVerificationToken,
  formatVerificationRecord,
} from '@/server/calendar/service/import/hmac';
import { validateProductionSecrets } from '@/server/common/helper/production-validation';
import logger from '@/server/common/helper/logger';

/**
 * Tests for ICS import HMAC helpers and the production startup guard
 * added in pv-1qcp.1.8.
 */

describe('calendar.import HMAC helper', () => {
  const sandbox = sinon.createSandbox();
  let originalNodeEnv: string | undefined;

  const SOURCE_ID = '11111111-1111-1111-1111-111111111111';
  const CALENDAR_ID = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    sandbox.restore();
  });

  it('reads the secret from config', () => {
    // test.yaml provides the stable test secret
    const secret = getImportHmacSecret();
    expect(secret).toBe('test-hmac-secret-stable-value');
  });

  it('generates a deterministic token for the same inputs', () => {
    const a = generateVerificationToken(SOURCE_ID, CALENDAR_ID);
    const b = generateVerificationToken(SOURCE_ID, CALENDAR_ID);
    expect(a).toBe(b);
  });

  it('generates different tokens for different inputs', () => {
    const t1 = generateVerificationToken(SOURCE_ID, CALENDAR_ID);
    const t2 = generateVerificationToken(SOURCE_ID, 'another-calendar-id');
    const t3 = generateVerificationToken('another-source-id', CALENDAR_ID);
    expect(t1).not.toBe(t2);
    expect(t1).not.toBe(t3);
    expect(t2).not.toBe(t3);
  });

  it('produces a base64url-encoded HMAC-SHA256 digest', () => {
    const token = generateVerificationToken(SOURCE_ID, CALENDAR_ID);
    // base64url uses A-Z, a-z, 0-9, -, _ and no padding
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);

    // Independently compute the expected digest to verify algorithm
    const expected = crypto
      .createHmac('sha256', 'test-hmac-secret-stable-value')
      .update(SOURCE_ID)
      .update(CALENDAR_ID)
      .digest('base64url');
    expect(token).toBe(expected);
  });

  it('never contains the plaintext secret', () => {
    const token = generateVerificationToken(SOURCE_ID, CALENDAR_ID);
    expect(token).not.toContain('test-hmac-secret-stable-value');
  });

  it('formatVerificationRecord uses pavillion-verify=v1 prefix with domain', () => {
    const record = formatVerificationRecord(SOURCE_ID, CALENDAR_ID);
    const expectedDomain = config.get<string>('domain');
    const expectedToken = generateVerificationToken(SOURCE_ID, CALENDAR_ID);
    expect(record).toBe(`pavillion-verify=v1:${expectedDomain}:${expectedToken}`);
    expect(record).not.toContain('test-hmac-secret-stable-value');
  });

  it('token is not logged by the helpers at info+ level', () => {
    const infoSpy = sandbox.spy(logger, 'info');
    const warnSpy = sandbox.spy(logger, 'warn');
    const errorSpy = sandbox.spy(logger, 'error');

    const token = generateVerificationToken(SOURCE_ID, CALENDAR_ID);
    formatVerificationRecord(SOURCE_ID, CALENDAR_ID);

    const allLogCalls = [
      ...infoSpy.getCalls(),
      ...warnSpy.getCalls(),
      ...errorSpy.getCalls(),
    ];
    for (const call of allLogCalls) {
      const serialized = JSON.stringify(call.args);
      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain('test-hmac-secret-stable-value');
    }
  });

  it('throws in production when secret is empty', () => {
    process.env.NODE_ENV = 'production';
    const getStub = sandbox.stub(config, 'get');
    const hasStub = sandbox.stub(config, 'has');
    hasStub.withArgs('calendar.import.hmacSecret').returns(true);
    getStub.withArgs('calendar.import.hmacSecret').returns('');

    expect(() => getImportHmacSecret()).toThrow(/CALENDAR_IMPORT_HMAC_SECRET must be set in production/);
  });

  it('throws in production when secret is a development-only value', () => {
    process.env.NODE_ENV = 'production';
    const getStub = sandbox.stub(config, 'get');
    const hasStub = sandbox.stub(config, 'has');
    hasStub.withArgs('calendar.import.hmacSecret').returns(true);
    getStub
      .withArgs('calendar.import.hmacSecret')
      .returns('development-only-hmac-secret-do-not-use-in-production');

    expect(() => getImportHmacSecret()).toThrow(/CALENDAR_IMPORT_HMAC_SECRET must be set in production/);
  });

  it('does not throw in non-production when secret is empty', () => {
    process.env.NODE_ENV = 'test';
    const getStub = sandbox.stub(config, 'get');
    const hasStub = sandbox.stub(config, 'has');
    hasStub.withArgs('calendar.import.hmacSecret').returns(true);
    getStub.withArgs('calendar.import.hmacSecret').returns('');

    expect(() => getImportHmacSecret()).not.toThrow();
  });
});

describe('validateProductionSecrets — calendar.import.hmacSecret guard', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('throws when calendar.import.hmacSecret is missing', () => {
    const getStub = sandbox.stub(config, 'get');
    const hasStub = sandbox.stub(config, 'has');
    hasStub.withArgs('database.password').returns(true);
    getStub.withArgs('database.password').returns('test-db-password');
    getStub.withArgs('jwt.secret').returns('custom-jwt-secret-xyzabc123');
    getStub.withArgs('session.secret').returns('custom-session-secret-xyzabc123');
    getStub.withArgs('moderation.emailHashSecret').returns('custom-email-hash-secret-xyzabc123');
    getStub.withArgs('funding.encryptionKey').returns('custom-encryption-key-xyzabc123');
    hasStub.withArgs('calendar.import.hmacSecret').returns(true);
    getStub.withArgs('calendar.import.hmacSecret').returns('');

    expect(() => validateProductionSecrets()).toThrow(/CALENDAR_IMPORT_HMAC_SECRET must be set in production/);
  });

  it('throws when calendar.import.hmacSecret is a development-only value', () => {
    const getStub = sandbox.stub(config, 'get');
    const hasStub = sandbox.stub(config, 'has');
    hasStub.withArgs('database.password').returns(true);
    getStub.withArgs('database.password').returns('test-db-password');
    getStub.withArgs('jwt.secret').returns('custom-jwt-secret-xyzabc123');
    getStub.withArgs('session.secret').returns('custom-session-secret-xyzabc123');
    getStub.withArgs('moderation.emailHashSecret').returns('custom-email-hash-secret-xyzabc123');
    getStub.withArgs('funding.encryptionKey').returns('custom-encryption-key-xyzabc123');
    hasStub.withArgs('calendar.import.hmacSecret').returns(true);
    getStub
      .withArgs('calendar.import.hmacSecret')
      .returns('development-only-hmac-secret-do-not-use-in-production');

    expect(() => validateProductionSecrets()).toThrow(/CALENDAR_IMPORT_HMAC_SECRET must be set in production/);
  });

  it('passes when all secrets are configured with non-dev values', () => {
    const getStub = sandbox.stub(config, 'get');
    const hasStub = sandbox.stub(config, 'has');
    hasStub.withArgs('database.password').returns(true);
    getStub.withArgs('database.password').returns('test-db-password');
    getStub.withArgs('jwt.secret').returns('custom-jwt-secret-xyzabc123');
    getStub.withArgs('session.secret').returns('custom-session-secret-xyzabc123');
    getStub.withArgs('moderation.emailHashSecret').returns('custom-email-hash-secret-xyzabc123');
    getStub.withArgs('funding.encryptionKey').returns('custom-encryption-key-xyzabc123');
    hasStub.withArgs('calendar.import.hmacSecret').returns(true);
    getStub.withArgs('calendar.import.hmacSecret').returns('custom-import-hmac-secret-xyzabc123');

    expect(() => validateProductionSecrets()).not.toThrow();
  });
});

describe('calendar.import.dohResolvers config', () => {
  it('is present and contains Cloudflare + Google defaults', () => {
    const resolvers = config.get<string[]>('calendar.import.dohResolvers');
    expect(Array.isArray(resolvers)).toBe(true);
    expect(resolvers).toContain('https://1.1.1.1/dns-query');
    expect(resolvers).toContain('https://8.8.8.8/dns-query');
  });
});
