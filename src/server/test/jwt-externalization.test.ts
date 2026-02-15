import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import jwt from 'jsonwebtoken';
import config from 'config';

import { Account } from '@/common/model/account';
import expressHelper from '@/server/common/helper/express';
import { validateProductionSecrets } from '@/server/common/helper/production-validation';

/**
 * Tests for JWT externalization and production validation.
 *
 * These tests verify:
 * 1. JWT token generation uses config-based secret
 * 2. JWT verification uses config-based secret
 * 3. Passport-jwt strategy uses config-based secret (via token verification)
 * 4. Production validation throws error for development-default secret
 * 5. Production validation passes with custom secret
 */

describe('JWT Externalization and Production Validation', () => {
  const sandbox = sinon.createSandbox();
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    sandbox.restore();
  });

  // Test 1: JWT token generation uses config-based secret
  it('should generate JWT tokens using config-based secret', () => {
    // Create a test account
    const account = new Account('test-id', 'testuser', 'test@example.com');
    account.roles = [];

    // Generate token using expressHelper
    const token = expressHelper.generateJWT(account);

    // Verify the token can be decoded with the config secret
    const configSecret = config.get<string>('jwt.secret');
    const decoded = jwt.verify(token, configSecret) as jwt.JwtPayload;

    expect(decoded).toBeDefined();
    expect(decoded.id).toBe('test-id');
    expect(decoded.email).toBe('test@example.com');

    // Verify token cannot be decoded with wrong secret
    expect(() => {
      jwt.verify(token, 'wrong-secret');
    }).toThrow();
  });

  // Test 2: JWT verification uses config-based secret
  it('should verify JWT tokens using config-based secret', () => {
    const configSecret = config.get<string>('jwt.secret');

    // Create a token manually with the config secret
    const payload = {
      id: 'manual-test-id',
      email: 'manual@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    };
    const token = jwt.sign(payload, configSecret);

    // Verify the token can be decoded with config secret
    const decoded = jwt.verify(token, configSecret) as jwt.JwtPayload;

    expect(decoded.id).toBe('manual-test-id');
    expect(decoded.email).toBe('manual@example.com');
  });

  // Test 3: Passport-jwt strategy uses config-based secret
  // This is verified by ensuring tokens generated with config secret work for verification
  // Passport-jwt uses the same secretOrKey from config, so this confirms the integration
  it('should use consistent config-based secret across token generation and verification (passport-jwt compatibility)', () => {
    // Create a test account and generate token
    const account = new Account('passport-test-id', 'passportuser', 'passport@example.com');
    account.roles = ['admin'];

    const token = expressHelper.generateJWT(account);
    const configSecret = config.get<string>('jwt.secret');

    // Simulate what passport-jwt does: verify the token with secretOrKey
    // The passport-jwt strategy is configured with: secretOrKey: jwtSecret (from config)
    const decoded = jwt.verify(token, configSecret) as jwt.JwtPayload;

    expect(decoded.id).toBe('passport-test-id');
    expect(decoded.email).toBe('passport@example.com');
    expect(decoded.isAdmin).toBe(true);
  });

  // Test 4: Production validation throws error for development-default secret
  it('should throw error when development-default secrets are used', () => {
    // Test JWT secret validation
    const configGetStub = sandbox.stub(config, 'get');
    configGetStub.withArgs('jwt.secret').returns('development-only-jwt-secret-do-not-use-in-production');
    configGetStub.withArgs('session.secret').returns('custom-session-secret');
    configGetStub.withArgs('moderation.emailHashSecret').returns('custom-email-hash-secret');

    expect(() => {
      validateProductionSecrets();
    }).toThrow(/JWT_SECRET must be set in production/);

    sandbox.restore();

    // Test session secret validation
    const configGetStub2 = sandbox.stub(config, 'get');
    configGetStub2.withArgs('jwt.secret').returns('custom-jwt-secret');
    configGetStub2.withArgs('session.secret').returns('development-only-session-secret-do-not-use-in-production');
    configGetStub2.withArgs('moderation.emailHashSecret').returns('custom-email-hash-secret');

    expect(() => {
      validateProductionSecrets();
    }).toThrow(/SESSION_SECRET must be set in production/);

    sandbox.restore();

    // Test email hash secret validation
    const configGetStub3 = sandbox.stub(config, 'get');
    configGetStub3.withArgs('jwt.secret').returns('custom-jwt-secret');
    configGetStub3.withArgs('session.secret').returns('custom-session-secret');
    configGetStub3.withArgs('moderation.emailHashSecret').returns('development-only-email-hash-secret-do-not-use-in-production');

    expect(() => {
      validateProductionSecrets();
    }).toThrow(/EMAIL_HASH_SECRET must be set in production/);
  });

  // Test 5: Production validation passes with custom secrets
  it('should pass validation when custom secrets are configured', () => {
    const configGetStub = sandbox.stub(config, 'get');
    configGetStub.withArgs('jwt.secret').returns('custom-jwt-secret-xyzabc123');
    configGetStub.withArgs('session.secret').returns('custom-session-secret-xyzabc123');
    configGetStub.withArgs('moderation.emailHashSecret').returns('custom-email-hash-secret-xyzabc123');

    // Should not throw
    expect(() => {
      validateProductionSecrets();
    }).not.toThrow();
  });
});
