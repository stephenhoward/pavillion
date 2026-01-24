import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

describe('Calendar Actor Endpoints', () => {
  let account: Account;
  let calendar: Calendar;
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // Set up test account and calendar
    const accountInfo = await accountService._setupAccount('calendaractortest@pavillion.dev', 'testpassword');
    account = accountInfo.account;
    calendar = await calendarInterface.createCalendar(account, 'test-calendar');
  });

  afterAll(async () => {
    await env.cleanup();
  });

  describe('GET /calendars/:urlname', () => {
    it('should return Group actor JSON-LD with correct @context', async () => {
      const response = await request(env.app)
        .get(`/calendars/${calendar.urlName}`)
        .expect(200);

      expect(response.headers['content-type']).toContain('application/activity+json');

      const actor = response.body;
      expect(actor['@context']).toEqual([
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1',
      ]);
      expect(actor.type).toBe('Organization');
      expect(actor.id).toContain(`/calendars/${calendar.urlName}`);
    });

    it('should return 404 for non-existent calendar', async () => {
      await request(env.app)
        .get('/calendars/nonexistent')
        .expect(404);
    });

    it('should include inbox, outbox, and editors collection URLs', async () => {
      const response = await request(env.app)
        .get(`/calendars/${calendar.urlName}`)
        .expect(200);

      const actor = response.body;
      expect(actor.inbox).toContain(`/calendars/${calendar.urlName}/inbox`);
      expect(actor.outbox).toContain(`/calendars/${calendar.urlName}/outbox`);
      expect(actor.editors).toContain(`/calendars/${calendar.urlName}/editors`);
    });

    it('should include publicKey with correct keyId format', async () => {
      const response = await request(env.app)
        .get(`/calendars/${calendar.urlName}`)
        .expect(200);

      const actor = response.body;
      expect(actor.publicKey).toBeDefined();
      expect(actor.publicKey.id).toBe(`${actor.id}#main-key`);
      expect(actor.publicKey.owner).toBe(actor.id);
      expect(actor.publicKey.publicKeyPem).toBeDefined();
    });

    it('should set Content-Type to application/activity+json', async () => {
      const response = await request(env.app)
        .get(`/calendars/${calendar.urlName}`)
        .expect(200);

      expect(response.headers['content-type']).toContain('application/activity+json');
    });
  });

  describe('POST /calendars/:urlname/inbox', () => {
    it('should exist and respond at new URL', async () => {
      // This endpoint requires HTTP signature verification, so will return 401
      // We just want to verify the endpoint exists (not 404)
      const response = await request(env.app)
        .post(`/calendars/${calendar.urlName}/inbox`)
        .send({
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Follow',
          actor: 'https://other.example/calendars/remote',
          object: `https://localhost:3099/calendars/${calendar.urlName}`,
        });

      // Should not be 404 (endpoint exists)
      // May be 401 (missing signature) or 400 (invalid activity) which is expected
      expect(response.status).not.toBe(404);
    });
  });
});
