/**
 * Tests for federated ActivityPub dispatch in EventService.
 *
 * All three call sites (Create, Update, Delete) are now migrated off the inline
 * axios.post pathway:
 *   - Create  -> activityPubInterface.deliverActivitySigned (signed sync delivery
 *                because the caller reads back the remote response body to
 *                construct the local CalendarEvent model). SSRF validation,
 *                signing, and timeout enforcement happen inside the helper.
 *   - Update  -> activityPubInterface.addToOutbox (signed async delivery via
 *                the outbox worker, single-recipient via explicit `to`).
 *   - Delete  -> activityPubInterface.addToOutbox (same as Update).
 *
 * SSRF protection for the migrated paths is exercised in the AP-domain tests
 * for the outbox helper / worker. The calendar-domain tests here verify the
 * service-layer contract: which AP method is called, with what activity shape,
 * and how the helper's response/exceptions are mapped to caller-visible errors.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import type { CalendarActor } from '@/server/activitypub/entity/calendar_actor';
import EventService from '@/server/calendar/service/events';
import CalendarService from '@/server/calendar/service/calendar';
import { InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import { FederationDeliveryError } from '@/common/exceptions/activitypub';

const REMOTE_INBOX_URL = 'https://remote.example.com/inbox';

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
 * Creates a mock ActivityPubInterface with the methods used by EventService
 * stubbed: getUserActorUri, addToOutbox, and deliverActivitySigned.
 */
function buildMockApInterface() {
  return {
    getUserActorUri: sinon.stub().resolves('https://local.example.com/users/test'),
    addToOutbox: sinon.stub().resolves(),
    deliverActivitySigned: sinon.stub().resolves({ status: 202, data: null }),
  } as any;
}

describe('EventService', () => {
  describe('createRemoteEvent (migrated to deliverActivitySigned)', () => {
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
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('signs Create delivery with the user actor URI matching activity.actor', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      mockApInterface.deliverActivitySigned.resolves({ status: 202, data: null });

      await (service as any).createRemoteEvent(account, remoteCalendarActor, eventParams);

      expect(mockApInterface.deliverActivitySigned.calledOnce).toBe(true);
      const [signingActorUri, activityArg, inboxUrlArg] = mockApInterface.deliverActivitySigned.firstCall.args;
      // Per epic per-call-site signing actor table: Create signs with the user
      // actor URI, which must equal the activity's `actor` field so the keyId
      // is valid at the receiver.
      expect(signingActorUri).toBe('https://local.example.com/users/test');
      expect(activityArg.actor).toBe(signingActorUri);
      expect(activityArg.type).toBe('Create');
      expect(activityArg.to).toEqual([remoteCalendarActor.actorUri]);
      expect(inboxUrlArg).toBe(REMOTE_INBOX_URL);
    });

    it('uses returned event data when remote response has data with an id', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      const remoteEventId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      mockApInterface.deliverActivitySigned.resolves({
        status: 200,
        data: {
          id: remoteEventId,
          calendarId: remoteCalendarActor.id,
        },
      });

      const result = await (service as any).createRemoteEvent(account, remoteCalendarActor, eventParams);
      expect(result.id).toBe(remoteEventId);
    });

    it('falls back to a locally-constructed event when response.data is null (e.g. empty 202)', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      mockApInterface.deliverActivitySigned.resolves({ status: 202, data: null });

      const result = await (service as any).createRemoteEvent(account, remoteCalendarActor, eventParams);
      // Falls back to a locally-constructed CalendarEvent with the calendar ID
      // matching the remote calendar actor.
      expect(result).toBeDefined();
      expect(result.calendarId).toBe(remoteCalendarActor.id);
    });

    it('falls back when response.data is non-null but has no id', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      // Some receivers return an empty object on success.
      mockApInterface.deliverActivitySigned.resolves({ status: 200, data: {} });

      const result = await (service as any).createRemoteEvent(account, remoteCalendarActor, eventParams);
      expect(result).toBeDefined();
      expect(result.calendarId).toBe(remoteCalendarActor.id);
    });

    it('throws InsufficientCalendarPermissionsError when remote returns 403', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      // Per the new contract, non-2xx is a *resolved* { status, data: null }
      // — the service must inspect status, not catch an axios-style error.
      mockApInterface.deliverActivitySigned.resolves({ status: 403, data: null });

      await expect(
        (service as any).createRemoteEvent(account, remoteCalendarActor, eventParams),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('throws a generic error for other non-2xx statuses', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      mockApInterface.deliverActivitySigned.resolves({ status: 500, data: null });

      await expect(
        (service as any).createRemoteEvent(account, remoteCalendarActor, eventParams),
      ).rejects.toThrow('Failed to create event on remote calendar');
    });

    it('wraps FederationDeliveryError thrown by the helper as a generic error', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      mockApInterface.deliverActivitySigned.rejects(
        new FederationDeliveryError('Network failure delivering to remote inbox'),
      );

      await expect(
        (service as any).createRemoteEvent(account, remoteCalendarActor, eventParams),
      ).rejects.toThrow('Failed to create event on remote calendar');
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
