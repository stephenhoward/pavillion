/**
 * Tests for federated ActivityPub dispatch in EventService.
 *
 * All three call sites (Create, Update, Delete) now delegate to typed
 * publisher methods on ActivityPubInterface. The AP domain owns activity
 * construction, signing-actor resolution, and remote response handling:
 *   - Create  -> activityPubInterface.publishEventCreate (synchronous because
 *                the caller reads the remote response body to construct the
 *                local CalendarEvent model). 403 surfaces as
 *                InsufficientCalendarPermissionsError; other non-2xx and
 *                FederationDeliveryError surface as a generic Error.
 *   - Update  -> activityPubInterface.publishEventUpdate (fire-and-forget).
 *   - Delete  -> activityPubInterface.publishEventDelete (fire-and-forget).
 *
 * SSRF protection is enforced inside the AP-domain helpers (outbox worker /
 * deliverActivitySigned) and is exercised in the AP-domain tests. The
 * calendar-domain tests here verify the service-layer contract: which
 * publisher method is called with which arguments, and how publisher
 * exceptions surface to callers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { CalendarEvent } from '@/common/model/events';
import type { CalendarActor } from '@/server/activitypub/entity/calendar_actor';
import EventService from '@/server/calendar/service/events';
import { InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';

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
 * Creates a mock ActivityPubInterface stubbed with the typed publish methods
 * EventService now calls. Defaults to no-op resolutions.
 */
function buildMockApInterface() {
  return {
    publishEventCreate: sinon.stub().resolves(),
    publishEventUpdate: sinon.stub().resolves(),
    publishEventDelete: sinon.stub().resolves(),
  } as any;
}

describe('EventService', () => {
  describe('createRemoteEvent (migrated to publishEventCreate)', () => {
    let service: EventService;
    let account: Account;
    let mockApInterface: any;

    beforeEach(() => {
      service = new EventService(new EventEmitter());
      mockApInterface = buildMockApInterface();
      service.setActivityPubInterface(mockApInterface);
      account = new Account('account-123', 'test@example.com', 'test@example.com');
    });

    it('delegates to publishEventCreate with eventId, eventParams, and remoteCalendarActor', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      const stubReturn = new CalendarEvent('returned-id', remoteCalendarActor.id, '', false);
      mockApInterface.publishEventCreate.resolves(stubReturn);

      await (service as any).createRemoteEvent(account, remoteCalendarActor, eventParams);

      expect(mockApInterface.publishEventCreate.calledOnce).toBe(true);
      const [accountArg, eventInput, actorArg] = mockApInterface.publishEventCreate.firstCall.args;
      expect(accountArg).toBe(account);
      expect(eventInput).toHaveProperty('eventId');
      expect(typeof eventInput.eventId).toBe('string');
      expect(eventInput.eventParams).toBe(eventParams);
      expect(actorArg).toBe(remoteCalendarActor);
    });

    it('returns the CalendarEvent resolved by publishEventCreate', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      const expected = new CalendarEvent('publisher-eventid', remoteCalendarActor.id, '', false);
      mockApInterface.publishEventCreate.resolves(expected);

      const result = await (service as any).createRemoteEvent(account, remoteCalendarActor, eventParams);
      expect(result).toBe(expected);
    });

    it('propagates InsufficientCalendarPermissionsError thrown by publishEventCreate (e.g. remote 403)', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      mockApInterface.publishEventCreate.rejects(
        new InsufficientCalendarPermissionsError('You are not authorized to create events on this calendar'),
      );

      await expect(
        (service as any).createRemoteEvent(account, remoteCalendarActor, eventParams),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('propagates generic errors thrown by publishEventCreate (non-2xx, federation delivery, etc.)', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      mockApInterface.publishEventCreate.rejects(
        new Error('[AP] Failed to create event on remote calendar: remote returned status 500'),
      );

      await expect(
        (service as any).createRemoteEvent(account, remoteCalendarActor, eventParams),
      ).rejects.toThrow('Failed to create event on remote calendar');
    });
  });

  describe('updateRemoteEventViaActivityPub (migrated to publishEventUpdate)', () => {
    let service: EventService;
    let account: Account;
    let mockApInterface: any;

    beforeEach(() => {
      service = new EventService(new EventEmitter());
      mockApInterface = buildMockApInterface();
      service.setActivityPubInterface(mockApInterface);
      account = new Account('account-123', 'test@example.com', 'test@example.com');
    });

    it('delegates to publishEventUpdate with eventId, eventParams, and remoteCalendarActor', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventId = '11111111-1111-4111-8111-111111111111';
      const eventParams = {
        content: { en: { name: 'Updated Event', description: 'Updated description' } },
        start_date: '2026-03-02',
        start_time: '11:00',
      };

      await (service as any).updateRemoteEventViaActivityPub(account, remoteCalendarActor, eventId, eventParams);

      expect(mockApInterface.publishEventUpdate.calledOnce).toBe(true);
      const [accountArg, eventInput, actorArg] = mockApInterface.publishEventUpdate.firstCall.args;
      expect(accountArg).toBe(account);
      expect(eventInput).toEqual({ eventId, eventParams });
      expect(actorArg).toBe(remoteCalendarActor);
    });

    it('returns a locally-constructed CalendarEvent reflecting the input params', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventId = '11111111-1111-4111-8111-111111111111';
      const eventParams = {
        content: { en: { name: 'Updated Event', description: 'Updated description' } },
      };

      const result = await (service as any).updateRemoteEventViaActivityPub(
        account,
        remoteCalendarActor,
        eventId,
        eventParams,
      );

      expect(result).toBeDefined();
      expect(result.id).toBe(eventId);
      expect(result.calendarId).toBe(remoteCalendarActor.id);
    });

    it('propagates errors thrown by publishEventUpdate (e.g. missing inbox URL)', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor('');
      const eventId = '11111111-1111-4111-8111-111111111111';
      const eventParams = {
        content: { en: { name: 'Updated Event', description: 'Updated description' } },
      };

      mockApInterface.publishEventUpdate.rejects(new Error('Remote calendar inbox URL not configured'));

      await expect(
        (service as any).updateRemoteEventViaActivityPub(account, remoteCalendarActor, eventId, eventParams),
      ).rejects.toThrow();
    });
  });

  describe('deleteRemoteEventViaActivityPub (migrated to publishEventDelete)', () => {
    let service: EventService;
    let account: Account;
    let mockApInterface: any;

    beforeEach(() => {
      service = new EventService(new EventEmitter());
      mockApInterface = buildMockApInterface();
      service.setActivityPubInterface(mockApInterface);
      account = new Account('account-123', 'test@example.com', 'test@example.com');
    });

    it('delegates to publishEventDelete with eventId and remoteCalendarActor', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(REMOTE_INBOX_URL);
      const eventId = '22222222-2222-4222-8222-222222222222';

      await (service as any).deleteRemoteEventViaActivityPub(account, remoteCalendarActor, eventId);

      expect(mockApInterface.publishEventDelete.calledOnce).toBe(true);
      const [accountArg, eventIdArg, actorArg] = mockApInterface.publishEventDelete.firstCall.args;
      expect(accountArg).toBe(account);
      expect(eventIdArg).toBe(eventId);
      expect(actorArg).toBe(remoteCalendarActor);
    });

    it('propagates errors thrown by publishEventDelete (e.g. missing inbox URL)', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor('');
      const eventId = '22222222-2222-4222-8222-222222222222';

      mockApInterface.publishEventDelete.rejects(new Error('Remote calendar inbox URL not configured'));

      await expect(
        (service as any).deleteRemoteEventViaActivityPub(account, remoteCalendarActor, eventId),
      ).rejects.toThrow();
    });
  });
});
