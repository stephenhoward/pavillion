/**
 * Tests for SSRF protection in EventService remote ActivityPub dispatch methods.
 *
 * These tests verify that the three methods that POST to federation-supplied
 * inbox URLs (createRemoteEvent, updateRemoteEventViaActivityPub,
 * deleteRemoteEventViaActivityPub) correctly validate inbox URLs before
 * dispatching via axios, blocking delivery when the URL resolves to a private
 * IP address.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { CalendarActor } from '@/server/activitypub/entity/calendar_actor';
import { UserActorEntity } from '@/server/activitypub/entity/user_actor';
import EventService from '@/server/calendar/service/events';
import * as ipValidation from '@/server/activitypub/helper/ip-validation';

const REMOTE_INBOX_URL = 'https://remote.example.com/inbox';
const PRIVATE_INBOX_URL = 'https://192.168.1.1/inbox';

/**
 * Builds a minimal CalendarActor model for testing.
 */
function buildRemoteCalendarActor(inboxUrl: string): CalendarActor {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    actorType: 'remote' as const,
    calendarId: null,
    remoteCalendarId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    actorUri: 'https://remote.example.com/calendars/test-calendar',
    remoteDisplayName: 'Test Remote Calendar',
    remoteDomain: 'remote.example.com',
    inboxUrl: inboxUrl,
    sharedInboxUrl: null,
    lastFetched: new Date(),
    publicKey: 'mock-public-key',
    privateKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CalendarActor;
}

describe('EventService', () => {
  describe('createRemoteEvent', () => {
    let service: EventService;
    let sandbox: sinon.SinonSandbox;
    let account: Account;
    let postStub: sinon.SinonStub;
    let validateUrlStub: sinon.SinonStub;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      service = new EventService(new EventEmitter());
      account = new Account('account-123', 'test@example.com', 'test@example.com');

      // Stub UserActorEntity so the method can proceed past the identity check
      sandbox.stub(UserActorEntity, 'findOne').resolves({
        account_id: account.id,
        actor_uri: 'https://local.example.com/users/test',
      } as any);

      postStub = sandbox.stub(axios, 'post');

      // Default: SSRF validation passes
      validateUrlStub = sandbox.stub(ipValidation, 'validateUrlNotPrivate').resolves(true);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should throw and NOT call axios.post when inbox URL is a private IP (SSRF)', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(PRIVATE_INBOX_URL);
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      // Override: simulate validateUrlNotPrivate blocking a private IP
      validateUrlStub.rejects(
        new Error('Access to private IP address 192.168.1.1 is not allowed'),
      );

      await expect(
        (service as any).createRemoteEvent(account, remoteCalendarActor, eventParams),
      ).rejects.toThrow('Security: Blocked delivery to private inbox URL');

      expect(postStub.called).toBe(false);
    });

    it('should call axios.post when inbox URL passes SSRF validation', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      postStub.resolves({ status: 200, data: {} });

      await (service as any).createRemoteEvent(account, remoteCalendarActor, eventParams);

      expect(postStub.called).toBe(true);
      expect(postStub.firstCall.args[0]).toBe(REMOTE_INBOX_URL);
    });
  });

  describe('updateRemoteEventViaActivityPub', () => {
    let service: EventService;
    let sandbox: sinon.SinonSandbox;
    let account: Account;
    let postStub: sinon.SinonStub;
    let validateUrlStub: sinon.SinonStub;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      service = new EventService(new EventEmitter());
      account = new Account('account-123', 'test@example.com', 'test@example.com');

      sandbox.stub(UserActorEntity, 'findOne').resolves({
        account_id: account.id,
        actor_uri: 'https://local.example.com/users/test',
      } as any);

      postStub = sandbox.stub(axios, 'post');

      // Default: SSRF validation passes
      validateUrlStub = sandbox.stub(ipValidation, 'validateUrlNotPrivate').resolves(true);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should throw and NOT call axios.post when inbox URL is a private IP (SSRF)', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(PRIVATE_INBOX_URL);
      const eventId = '11111111-1111-4111-8111-111111111111';
      const eventParams = {
        content: { en: { name: 'Updated Event', description: 'Updated description' } },
        start_date: '2026-03-02',
        start_time: '11:00',
      };

      validateUrlStub.rejects(
        new Error('Access to private IP address 192.168.1.1 is not allowed'),
      );

      await expect(
        (service as any).updateRemoteEventViaActivityPub(account, remoteCalendarActor, eventId, eventParams),
      ).rejects.toThrow('Security: Blocked delivery to private inbox URL');

      expect(postStub.called).toBe(false);
    });

    it('should call axios.post when inbox URL passes SSRF validation', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventId = '11111111-1111-4111-8111-111111111111';
      const eventParams = {
        content: { en: { name: 'Updated Event', description: 'Updated description' } },
        start_date: '2026-03-02',
        start_time: '11:00',
      };

      postStub.resolves({ status: 200, data: {} });

      await (service as any).updateRemoteEventViaActivityPub(account, remoteCalendarActor, eventId, eventParams);

      expect(postStub.called).toBe(true);
      expect(postStub.firstCall.args[0]).toBe(REMOTE_INBOX_URL);
    });
  });

  describe('deleteRemoteEventViaActivityPub', () => {
    let service: EventService;
    let sandbox: sinon.SinonSandbox;
    let account: Account;
    let postStub: sinon.SinonStub;
    let validateUrlStub: sinon.SinonStub;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      service = new EventService(new EventEmitter());
      account = new Account('account-123', 'test@example.com', 'test@example.com');

      sandbox.stub(UserActorEntity, 'findOne').resolves({
        account_id: account.id,
        actor_uri: 'https://local.example.com/users/test',
      } as any);

      postStub = sandbox.stub(axios, 'post');

      // Default: SSRF validation passes
      validateUrlStub = sandbox.stub(ipValidation, 'validateUrlNotPrivate').resolves(true);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should throw and NOT call axios.post when inbox URL is a private IP (SSRF)', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(PRIVATE_INBOX_URL);
      const eventId = '22222222-2222-4222-8222-222222222222';

      validateUrlStub.rejects(
        new Error('Access to private IP address 192.168.1.1 is not allowed'),
      );

      await expect(
        (service as any).deleteRemoteEventViaActivityPub(account, remoteCalendarActor, eventId),
      ).rejects.toThrow('Security: Blocked delivery to private inbox URL');

      expect(postStub.called).toBe(false);
    });

    it('should call axios.post when inbox URL passes SSRF validation', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventId = '22222222-2222-4222-8222-222222222222';

      postStub.resolves({ status: 200, data: {} });

      await (service as any).deleteRemoteEventViaActivityPub(account, remoteCalendarActor, eventId);

      expect(postStub.called).toBe(true);
      expect(postStub.firstCall.args[0]).toBe(REMOTE_INBOX_URL);
    });
  });
});
