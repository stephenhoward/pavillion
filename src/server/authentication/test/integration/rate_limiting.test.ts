import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import config from 'config';

import { TestEnvironment } from '@/server/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { EventEmitter } from 'events';

/**
 * Integration tests for authentication rate limiting.
 *
 * These tests verify that rate limiters are properly applied to authentication
 * endpoints and return appropriate 429 responses with rate limit headers when
 * the configured limits are exceeded.
 *
 * NOTE: These tests require rate limiting to be enabled in the test environment.
 * To run these tests, set rateLimit.enabled=true in config/test.yaml or use
 * NODE_CONFIG='{"rateLimit":{"enabled":true}}' npm test
 *
 * The tests share the same IP address (localhost) in the test environment,
 * so IP-based rate limits accumulate across test cases. The tests verify that
 * rate limiting is functioning correctly by checking for 429 responses and
 * appropriate headers, rather than expecting exact request counts.
 */

// Check if rate limiting is enabled - skip these tests if disabled
const rateLimitEnabled = config.get<boolean>('rateLimit.enabled');
const describeOrSkip = rateLimitEnabled ? describe : describe.skip;

describeOrSkip('Authentication Rate Limiting Integration Tests', () => {
  let env: TestEnvironment;
  let accountService: AccountService;
  const testEmail = 'ratelimit@pavillion.dev';
  const testPassword = 'testpassword123';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // Create test account for login tests
    await accountService._setupAccount(testEmail, testPassword);
  });

  afterAll(async () => {
    await env.cleanup();
  });

  describe('Password Reset Rate Limiting', () => {
    it('should include rate limit headers in password reset response', async () => {
      const response = await request(env.app)
        .post('/api/auth/v1/reset-password')
        .send({ email: `unique-${Date.now()}@example.com` });

      // May be 200 or 429 depending on prior test runs
      expect([200, 429]).toContain(response.status);

      // Verify rate limit headers are present
      expect(response.headers['ratelimit-limit']).toBeDefined();
      expect(response.headers['ratelimit-remaining']).toBeDefined();
      expect(response.headers['ratelimit-reset']).toBeDefined();
    });

    it('should enforce IP-based rate limit on password reset', async () => {
      const maxAttempts = 5; // From config: rateLimit.passwordReset.byIp.max
      const responses = [];

      // Use a unique base email to avoid email rate limit interference
      const baseTimestamp = Date.now();

      // Make requests until we hit the rate limit
      for (let i = 0; i < maxAttempts + 5; i++) {
        const response = await request(env.app)
          .post('/api/auth/v1/reset-password')
          .send({ email: `ipreset${baseTimestamp}-${i}@example.com` });

        responses.push(response);

        // Stop when we hit the rate limit
        if (response.status === 429) {
          break;
        }
      }

      // Should have at least one 429 response
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);

      // Verify the rate limited response has correct error message
      const rateLimitedResponse = rateLimitedResponses[0];
      expect(rateLimitedResponse.body.error).toBe('Too many password reset requests from this IP, please try again later.');

      // Verify rate limit headers
      expect(rateLimitedResponse.headers['ratelimit-limit']).toBe(String(maxAttempts));
      expect(rateLimitedResponse.headers['ratelimit-remaining']).toBe('0');
      expect(rateLimitedResponse.headers['retry-after']).toBeDefined();
    });

    it('should enforce email-based rate limit on password reset', async () => {
      const maxAttempts = 3; // From config: rateLimit.passwordReset.byEmail.max
      const sameEmail = `emailreset${Date.now()}@example.com`;
      const responses = [];

      // Make maxAttempts + 1 requests for the same email
      for (let i = 0; i < maxAttempts + 1; i++) {
        const response = await request(env.app)
          .post('/api/auth/v1/reset-password')
          .send({ email: sameEmail });

        responses.push(response);
      }

      // Count successful vs rate-limited responses
      const rateLimitedResponses = responses.filter(r => r.status === 429);

      // Should have at least one rate limited response (could be IP or email limit)
      expect(rateLimitedResponses.length).toBeGreaterThan(0);

      // Check if we hit the email-specific limit
      const emailRateLimited = rateLimitedResponses.find(r =>
        r.body.error === 'Too many password reset requests for this email, please try again later.',
      );

      if (emailRateLimited) {
        // Verify email rate limit headers
        expect(emailRateLimited.headers['ratelimit-limit']).toBe(String(maxAttempts));
        expect(emailRateLimited.headers['ratelimit-remaining']).toBe('0');
        expect(emailRateLimited.headers['retry-after']).toBeDefined();
      }
      else {
        // Hit IP limit instead, which is also valid behavior
        expect(rateLimitedResponses[0].body.error).toBe('Too many password reset requests from this IP, please try again later.');
      }
    });
  });

  describe('Login Rate Limiting', () => {
    it('should include rate limit headers in login response', async () => {
      const response = await request(env.app)
        .post('/api/auth/v1/login')
        .send({ email: `logintest${Date.now()}@example.com`, password: 'wrongpassword' });

      // Response will be 400 (wrong credentials) or 429 (rate limited)
      expect([400, 429]).toContain(response.status);

      // Rate limit headers should be present
      expect(response.headers['ratelimit-limit']).toBeDefined();
      expect(response.headers['ratelimit-remaining']).toBeDefined();
      expect(response.headers['ratelimit-reset']).toBeDefined();
    });

    it('should enforce IP-based rate limit on login', async () => {
      const maxAttempts = 10; // From config: rateLimit.login.byIp.max
      const responses = [];
      const baseTimestamp = Date.now();

      // Make requests until we hit rate limit
      for (let i = 0; i < maxAttempts + 5; i++) {
        const response = await request(env.app)
          .post('/api/auth/v1/login')
          .send({ email: `iplogin${baseTimestamp}-${i}@example.com`, password: 'wrongpassword' });

        responses.push(response);

        // Stop when we hit the rate limit
        if (response.status === 429) {
          break;
        }
      }

      // Should have at least one 429 response
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);

      // Verify the rate limited response has correct error message
      const rateLimitedResponse = rateLimitedResponses[0];
      expect(rateLimitedResponse.body.error).toBe('Too many login requests from this IP, please try again later.');

      // Verify rate limit headers
      expect(rateLimitedResponse.headers['ratelimit-limit']).toBe(String(maxAttempts));
      expect(rateLimitedResponse.headers['ratelimit-remaining']).toBe('0');
      expect(rateLimitedResponse.headers['retry-after']).toBeDefined();
    });

    it('should enforce email-based rate limit on login', async () => {
      const maxAttempts = 5; // From config: rateLimit.login.byEmail.max
      const sameEmail = `emaillogin${Date.now()}@example.com`;
      const responses = [];

      // Make requests until we hit rate limit
      for (let i = 0; i < maxAttempts + 1; i++) {
        const response = await request(env.app)
          .post('/api/auth/v1/login')
          .send({ email: sameEmail, password: 'wrongpassword' });

        responses.push(response);
      }

      // Count rate-limited responses
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);

      // Check if we hit the email-specific limit
      const emailRateLimited = rateLimitedResponses.find(r =>
        r.body.error === 'Too many login requests for this email, please try again later.',
      );

      if (emailRateLimited) {
        // Verify email rate limit headers
        expect(emailRateLimited.headers['ratelimit-limit']).toBe(String(maxAttempts));
        expect(emailRateLimited.headers['ratelimit-remaining']).toBe('0');
        expect(emailRateLimited.headers['retry-after']).toBeDefined();
      }
      else {
        // Hit IP limit instead, which is also valid behavior
        expect(rateLimitedResponses[0].body.error).toBe('Too many login requests from this IP, please try again later.');
      }
    });
  });

  describe('Rate Limit Header Format', () => {
    it('should return standard rate limit headers format', async () => {
      const response = await request(env.app)
        .post('/api/auth/v1/login')
        .send({ email: `format${Date.now()}@example.com`, password: 'wrongpassword' });

      // Verify header format (works for both 400 and 429 responses)
      const limit = parseInt(response.headers['ratelimit-limit']);
      const remaining = parseInt(response.headers['ratelimit-remaining']);
      const reset = parseInt(response.headers['ratelimit-reset']);

      expect(limit).toBeGreaterThan(0);
      expect(remaining).toBeGreaterThanOrEqual(0);
      expect(remaining).toBeLessThanOrEqual(limit);

      // Reset header can be either:
      // 1. A timestamp in seconds since epoch (future time)
      // 2. The number of seconds until reset (relative time)
      // express-rate-limit uses relative time in seconds
      expect(reset).toBeGreaterThan(0);
      expect(reset).toBeLessThanOrEqual(3600); // Should be within 1 hour max
    });

    it('should decrement remaining count on successive requests', async () => {
      const testEmailUnique = `decrement${Date.now()}@example.com`;

      const response1 = await request(env.app)
        .post('/api/auth/v1/reset-password')
        .send({ email: testEmailUnique });

      // Skip if already rate limited
      if (response1.status === 429) {
        return;
      }

      const response2 = await request(env.app)
        .post('/api/auth/v1/reset-password')
        .send({ email: testEmailUnique });

      // If second request is also successful, verify decrement
      if (response2.status === 200) {
        const remaining1 = parseInt(response1.headers['ratelimit-remaining']);
        const remaining2 = parseInt(response2.headers['ratelimit-remaining']);

        expect(remaining2).toBe(remaining1 - 1);
      }
      // If second request is rate limited, that's also valid - it means the email limit was hit
      else if (response2.status === 429) {
        expect(response2.headers['ratelimit-remaining']).toBe('0');
      }
    });
  });
});
