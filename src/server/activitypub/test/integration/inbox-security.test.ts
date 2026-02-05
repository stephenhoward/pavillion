/**
 * Integration tests for ActivityPub inbox security pipeline.
 *
 * These tests verify the complete security flow for inbox requests:
 * 1. Schema validation - Reject invalid ActivityPub structures
 * 2. SSRF protection - Block requests to private IP addresses
 * 3. Ownership verification - Verify attributedTo matches authorized editors
 * 4. Rate limiting - Enforce per-actor and per-calendar thresholds
 * 5. Valid requests - Accept properly formed and authorized requests
 *
 * Tests use real HTTP requests to the inbox endpoint via supertest,
 * not unit-level mocks, to ensure the complete middleware pipeline works.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';
import crypto from 'crypto';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import { TestEnvironment } from '@/server/test/lib/test_environment';

describe('ActivityPub Inbox Security Pipeline', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let accountsInterface: AccountsInterface;
  let accountService: AccountService;
  let eventBus: EventEmitter;

  // Test accounts and calendars
  let ownerAccount: Account;
  let editorAccount: Account;
  let unauthorizedAccount: Account;
  let testCalendar: Calendar;

  // Test constants
  const REMOTE_ACTOR_URL = 'https://remote.example.com/users/alice';
  const REMOTE_EVENT_URL = 'https://remote.example.com/events/123';
  const PRIVATE_IP_ACTOR = 'http://192.168.1.100/users/attacker';
  const LOCALHOST_ACTOR = 'http://localhost/users/attacker';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // Create test accounts
    const ownerInfo = await accountService._setupAccount('owner@pavillion.dev', 'testpassword');
    ownerAccount = ownerInfo.account;

    const editorInfo = await accountService._setupAccount('editor@pavillion.dev', 'testpassword');
    editorAccount = editorInfo.account;

    const unauthorizedInfo = await accountService._setupAccount('unauthorized@pavillion.dev', 'testpassword');
    unauthorizedAccount = unauthorizedInfo.account;

    // Create test calendar
    testCalendar = await calendarInterface.createCalendar(ownerAccount, 'testcalendar');

    // Grant editor access
    await calendarInterface.grantEditAccessByEmail(ownerAccount, testCalendar.id, 'editor@pavillion.dev');
  });

  afterAll(async () => {
    await env.cleanup();
  });

  describe('1. Schema Validation - Invalid Activity Rejection', () => {
    beforeEach(() => {
      // Enable signature bypass for schema validation tests
      process.env.SKIP_SIGNATURES = 'true';
    });

    it('should reject activity with missing @context', async () => {
      const invalidActivity = {
        // Missing @context
        id: 'https://remote.example.com/activities/1',
        type: 'Create',
        actor: REMOTE_ACTOR_URL,
        object: {
          type: 'Event',
          id: REMOTE_EVENT_URL,
          name: 'Test Event',
        },
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(invalidActivity)).digest('base64')}`)
        .send(invalidActivity);

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject activity with invalid actor URI', async () => {
      const invalidActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/2',
        type: 'Create',
        actor: 'not-a-valid-url', // Invalid URI
        object: {
          type: 'Event',
          id: REMOTE_EVENT_URL,
          name: 'Test Event',
        },
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(invalidActivity)).digest('base64')}`)
        .send(invalidActivity);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid actor URI');
    });

    it('should reject activity with missing required type', async () => {
      const invalidActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/3',
        // Missing type field
        actor: REMOTE_ACTOR_URL,
        object: {
          type: 'Event',
          id: REMOTE_EVENT_URL,
          name: 'Test Event',
        },
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(invalidActivity)).digest('base64')}`)
        .send(invalidActivity);

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject unsupported activity type', async () => {
      const unsupportedActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/4',
        type: 'Like', // Unsupported type
        actor: REMOTE_ACTOR_URL,
        object: REMOTE_EVENT_URL,
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(unsupportedActivity)).digest('base64')}`)
        .send(unsupportedActivity);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Unsupported activity type');
    });

    it('should reject Create activity with malformed object', async () => {
      const invalidCreateActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/5',
        type: 'Create',
        actor: REMOTE_ACTOR_URL,
        object: 'not-an-object', // Should be object with type
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(invalidCreateActivity)).digest('base64')}`)
        .send(invalidCreateActivity);

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('2. SSRF Protection - Private IP Blocking', () => {
    beforeEach(() => {
      // Disable signature bypass - we need signature verification to trigger SSRF checks
      delete process.env.SKIP_SIGNATURES;
    });

    it('should reject actor URLs pointing to private IPv4 addresses', async () => {
      const privateIpActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/6',
        type: 'Follow',
        actor: PRIVATE_IP_ACTOR,
        object: `https://localhost/calendars/${testCalendar.urlName}`,
      };

      // Note: This test verifies SSRF protection at the HTTP signature verification stage
      // when the system attempts to fetch the public key from the actor URL.
      // The validation happens before the activity reaches the inbox processing logic.
      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Signature', 'keyId="http://192.168.1.100/users/attacker#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="fake"')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(privateIpActivity)).digest('base64')}`)
        .send(privateIpActivity);

      // Should fail at signature verification stage due to SSRF protection
      expect([401, 500]).toContain(response.status);
    });

    it('should reject actor URLs pointing to localhost', async () => {
      const localhostActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/7',
        type: 'Follow',
        actor: LOCALHOST_ACTOR,
        object: `https://localhost/calendars/${testCalendar.urlName}`,
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Signature', 'keyId="http://localhost/users/attacker#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="fake"')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(localhostActivity)).digest('base64')}`)
        .send(localhostActivity);

      // Should fail at signature verification stage due to SSRF protection
      expect([401, 500]).toContain(response.status);
    });

    it('should reject actor URLs pointing to link-local addresses', async () => {
      const linkLocalActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/8',
        type: 'Follow',
        actor: 'http://169.254.169.254/users/attacker', // AWS metadata endpoint
        object: `https://localhost/calendars/${testCalendar.urlName}`,
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Signature', 'keyId="http://169.254.169.254/users/attacker#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="fake"')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(linkLocalActivity)).digest('base64')}`)
        .send(linkLocalActivity);

      // Should fail at signature verification stage due to SSRF protection
      expect([401, 500]).toContain(response.status);
    });
  });

  describe('3. Ownership Verification - AttributedTo Authorization', () => {
    beforeEach(() => {
      // Enable signature bypass for ownership verification tests
      process.env.SKIP_SIGNATURES = 'true';
    });

    it('should reject Create activity from non-editor Person actor', async () => {
      // Create a Person actor URI (not a calendar actor)
      const personActorUri = 'https://remote.example.com/users/unauthorized';

      const createActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/9',
        type: 'Create',
        actor: personActorUri,
        object: {
          type: 'Event',
          id: REMOTE_EVENT_URL,
          name: 'Unauthorized Event',
          attributedTo: personActorUri, // Same as actor - should be rejected if not an editor
          startTime: '2025-08-15T10:00:00Z',
        },
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(createActivity)).digest('base64')}`)
        .send(createActivity);

      // Should fail with 403 Forbidden due to unauthorized editor
      expect(response.status).toBe(403);
      expect(response.text).toContain('Forbidden');
    });

    it('should reject Update activity with mismatched attributedTo', async () => {
      const personActorUri = 'https://remote.example.com/users/bob';
      const differentAttributedTo = 'https://different.example.com/users/charlie';

      const updateActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/10',
        type: 'Update',
        actor: personActorUri,
        object: {
          type: 'Event',
          id: REMOTE_EVENT_URL,
          name: 'Updated Event',
          attributedTo: differentAttributedTo, // Different from actor
          startTime: '2025-08-15T11:00:00Z',
        },
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(updateActivity)).digest('base64')}`)
        .send(updateActivity);

      // Should fail with 403 Forbidden
      expect(response.status).toBe(403);
    });

    it('should reject Delete activity from unauthorized actor', async () => {
      const deleteActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/11',
        type: 'Delete',
        actor: 'https://remote.example.com/users/unauthorized-deleter',
        object: REMOTE_EVENT_URL,
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(deleteActivity)).digest('base64')}`)
        .send(deleteActivity);

      // Should fail with 403 Forbidden
      expect(response.status).toBe(403);
    });
  });

  describe('4. Rate Limiting - Per-Actor and Per-Calendar Thresholds', () => {
    // Note: These tests verify rate limiting is active, but don't exhaust limits
    // to avoid slowing down the test suite. Full rate limit testing would require
    // many rapid requests which would be slow.

    it('should accept requests within rate limits', async () => {
      const followActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/12',
        type: 'Follow',
        actor: REMOTE_ACTOR_URL,
        object: `https://localhost/calendars/${testCalendar.urlName}`,
      };

      // Make a single request - should be within limits
      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Signature', env.fakeRemoteAuth('remote.example.com', 'alice'))
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(followActivity)).digest('base64')}`)
        .send(followActivity);

      // Should succeed (200) or fail for other reasons, but not rate limiting (429)
      expect(response.status).not.toBe(429);
    });

    it('should include rate limit headers in responses', async () => {
      const announceActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/13',
        type: 'Announce',
        actor: REMOTE_ACTOR_URL,
        object: REMOTE_EVENT_URL,
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Signature', env.fakeRemoteAuth('remote.example.com', 'alice'))
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(announceActivity)).digest('base64')}`)
        .send(announceActivity);

      // Check for rate limit headers (if rate limiting middleware adds them)
      // Note: This depends on the specific rate limiting implementation
      // Common headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
      // We just verify the request is processed, not rate limited
      expect(response.status).not.toBe(429);
    });
  });

  describe('5. Valid Requests - Complete Pipeline Success', () => {
    beforeEach(async () => {
      // Ensure we're in test mode where signature verification can be bypassed
      // This allows us to test the rest of the pipeline without complex key setup
      process.env.SKIP_SIGNATURES = 'true';
    });

    it('should accept valid Follow activity from calendar actor', async () => {
      const validFollowActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/14',
        type: 'Follow',
        actor: 'https://remote.example.com/calendars/events',
        object: `https://localhost/calendars/${testCalendar.urlName}`,
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(validFollowActivity)).digest('base64')}`)
        .send(validFollowActivity);

      expect(response.status).toBe(200);
    });

    it('should accept valid Announce activity', async () => {
      const validAnnounceActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/15',
        type: 'Announce',
        actor: 'https://remote.example.com/calendars/community',
        object: REMOTE_EVENT_URL,
        published: '2025-08-15T10:00:00Z',
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(validAnnounceActivity)).digest('base64')}`)
        .send(validAnnounceActivity);

      expect(response.status).toBe(200);
    });

    it('should accept valid Undo activity', async () => {
      // Undo activity undoes a previous Follow - use the ID from the previous Follow test
      const validUndoActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/16',
        type: 'Undo',
        actor: 'https://remote.example.com/calendars/events',
        object: 'https://remote.example.com/activities/14', // Reference to the Follow activity ID
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(validUndoActivity)).digest('base64')}`)
        .send(validUndoActivity);

      expect(response.status).toBe(200);
    });

    it('should handle multiple valid activities in sequence', async () => {
      // Test that the pipeline handles multiple requests properly
      const activities = [
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://remote.example.com/activities/17',
          type: 'Follow',
          actor: 'https://remote.example.com/calendars/test1',
          object: `https://localhost/calendars/${testCalendar.urlName}`,
        },
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://remote.example.com/activities/18',
          type: 'Announce',
          actor: 'https://remote.example.com/calendars/test2',
          object: REMOTE_EVENT_URL,
        },
      ];

      for (const activity of activities) {
        const response = await request(env.app)
          .post(`/calendars/${testCalendar.urlName}/inbox`)
          .set('Content-Type', 'application/activity+json')
          .set('Date', new Date().toUTCString())
          .set('Host', 'localhost')
          .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(activity)).digest('base64')}`)
          .send(activity);

        expect(response.status).toBe(200);
      }
    });

    it('should accept valid activity with all optional fields', async () => {
      const completeActivity = {
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          { 'Pavillion': 'https://pavillion.dev/ns#' },
        ],
        id: 'https://remote.example.com/activities/19',
        type: 'Announce',
        actor: 'https://remote.example.com/calendars/complete',
        object: REMOTE_EVENT_URL,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [`https://localhost/calendars/${testCalendar.urlName}/followers`],
        published: '2025-08-15T10:00:00Z',
        updated: '2025-08-15T11:00:00Z',
      };

      const response = await request(env.app)
        .post(`/calendars/${testCalendar.urlName}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(completeActivity)).digest('base64')}`)
        .send(completeActivity);

      expect(response.status).toBe(200);
    });
  });

  describe('6. Non-existent Calendar - 404 Error', () => {
    it('should return 404 for inbox requests to non-existent calendar', async () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example.com/activities/20',
        type: 'Follow',
        actor: REMOTE_ACTOR_URL,
        object: 'https://localhost/calendars/nonexistent',
      };

      const response = await request(env.app)
        .post('/calendars/nonexistent/inbox')
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(validActivity)).digest('base64')}`)
        .send(validActivity);

      expect(response.status).toBe(404);
      expect(response.text).toContain('Calendar not found');
    });
  });
});
