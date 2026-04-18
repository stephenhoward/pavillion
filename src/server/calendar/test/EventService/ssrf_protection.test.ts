/**
 * Tests for SSRF protection in EventService remote ActivityPub dispatch methods.
 *
 * The Create call site (createRemoteEvent) still posts inline via axios and
 * its SSRF protection is verified here. The Update and Delete call sites have
 * been migrated to the signed outbox pathway (pv-dyyw.2.2): they now enqueue
 * activities via activityPubInterface.addToOutbox with explicit single-recipient
 * `to` delivery. SSRF validation for those paths happens in the outbox worker
 * (covered by AP-domain tests), so the calendar-domain tests for Update/Delete
 * verify activity shape and outbox enqueue rather than inline axios delivery.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import type { CalendarActor } from '@/server/activitypub/entity/calendar_actor';
import EventService from '@/server/calendar/service/events';
import CalendarService from '@/server/calendar/service/calendar';
import * as ipValidation from '@/server/common/helper/ip-validation';

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

/**
 * Creates a mock ActivityPubInterface with getUserActorUri stubbed to return
 * a test actor URI. addToOutbox is also stubbed for migrated call sites
 * (Update / Delete via signed outbox pathway).
 */
function buildMockApInterface() {
  return {
    getUserActorUri: sinon.stub().resolves('https://local.example.com/users/test'),
    addToOutbox: sinon.stub().resolves(),
  } as any;
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
      service.setActivityPubInterface(buildMockApInterface());
      account = new Account('account-123', 'test@example.com', 'test@example.com');

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

  describe('updateRemoteEventViaActivityPub (migrated to addToOutbox)', () => {
    let service: EventService;
    let sandbox: sinon.SinonSandbox;
    let account: Account;
    let mockApInterface: any;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      service = new EventService(new EventEmitter());
      mockApInterface = buildMockApInterface();
      service.setActivityPubInterface(mockApInterface);
      account = new Account('account-123', 'test@example.com', 'test@example.com');

      // The migrated path looks up the user's editable local calendars to
      // anchor the outbox message (calendar_id FK). Provide one.
      const userCalendar = new Calendar('local-cal-id', 'local_cal');
      sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser').resolves([userCalendar]);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should enqueue an Update activity via addToOutbox with explicit `to`', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventId = '11111111-1111-4111-8111-111111111111';
      const eventParams = {
        content: { en: { name: 'Updated Event', description: 'Updated description' } },
        start_date: '2026-03-02',
        start_time: '11:00',
      };

      await (service as any).updateRemoteEventViaActivityPub(account, remoteCalendarActor, eventId, eventParams);

      expect(mockApInterface.addToOutbox.calledOnce).toBe(true);
      const [calendarArg, activityArg] = mockApInterface.addToOutbox.firstCall.args;
      expect(calendarArg.id).toBe('local-cal-id');
      expect(activityArg.type).toBe('Update');
      expect(activityArg.actor).toBe('https://local.example.com/users/test');
      // Explicit single-recipient delivery — outbox worker honors `to` and
      // skips follower fan-out for Update activities (per pv-dyyw.1.2).
      expect(activityArg.to).toEqual([remoteCalendarActor.actorUri]);
    });

    it('should throw when remote calendar inbox URL is missing', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor('') as any;
      remoteCalendarActor.inboxUrl = null;
      const eventId = '11111111-1111-4111-8111-111111111111';
      const eventParams = {
        content: { en: { name: 'Updated Event', description: 'Updated description' } },
      };

      await expect(
        (service as any).updateRemoteEventViaActivityPub(account, remoteCalendarActor, eventId, eventParams),
      ).rejects.toThrow();

      expect(mockApInterface.addToOutbox.called).toBe(false);
    });
  });

  describe('deleteRemoteEventViaActivityPub (migrated to addToOutbox)', () => {
    let service: EventService;
    let sandbox: sinon.SinonSandbox;
    let account: Account;
    let mockApInterface: any;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      service = new EventService(new EventEmitter());
      mockApInterface = buildMockApInterface();
      service.setActivityPubInterface(mockApInterface);
      account = new Account('account-123', 'test@example.com', 'test@example.com');

      const userCalendar = new Calendar('local-cal-id', 'local_cal');
      sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser').resolves([userCalendar]);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should enqueue a Delete activity via addToOutbox with explicit `to`', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventId = '22222222-2222-4222-8222-222222222222';

      await (service as any).deleteRemoteEventViaActivityPub(account, remoteCalendarActor, eventId);

      expect(mockApInterface.addToOutbox.calledOnce).toBe(true);
      const [calendarArg, activityArg] = mockApInterface.addToOutbox.firstCall.args;
      expect(calendarArg.id).toBe('local-cal-id');
      expect(activityArg.type).toBe('Delete');
      expect(activityArg.actor).toBe('https://local.example.com/users/test');
      // Explicit single-recipient delivery — outbox worker honors `to` and
      // skips follower fan-out for Delete activities (per pv-dyyw.1.2).
      expect(activityArg.to).toEqual([remoteCalendarActor.actorUri]);
    });

    it('should throw when remote calendar inbox URL is missing', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor('') as any;
      remoteCalendarActor.inboxUrl = null;
      const eventId = '22222222-2222-4222-8222-222222222222';

      await expect(
        (service as any).deleteRemoteEventViaActivityPub(account, remoteCalendarActor, eventId),
      ).rejects.toThrow();

      expect(mockApInterface.addToOutbox.called).toBe(false);
    });
  });
});
