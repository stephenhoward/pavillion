/**
 * Tests for FederationPublisher service
 *
 * The FederationPublisher owns outbound event-lifecycle activity construction
 * (Create / Update / Delete / Add) for the AP domain. Activity construction was
 * previously inlined into the calendar domain (events.ts / calendar.ts); pv-yowo
 * moves it here so the AP domain owns its own wire format.
 *
 * These tests verify:
 *   - Activity shape (type, id, actor, to, object) per method
 *   - Signing-actor URI selection per method (user actor vs calendar actor)
 *   - Outbox-anchor resolution (editableCalendarsForUser[0] for user-actor
 *     activities, including the no-owning-calendar error case)
 *   - Create's response handling: 2xx with body, 2xx empty (202 fallback),
 *     403 -> InsufficientCalendarPermissionsError, other non-2xx -> generic
 *     error, FederationDeliveryError -> generic error
 *
 * Pattern model: src/server/activitypub/test/service/members.test.ts and
 *                src/server/calendar/test/EventService/ssrf_protection.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import FederationPublisher from '@/server/activitypub/service/federation_publisher';
import CalendarInterface from '@/server/calendar/interface';
import { UserActorEntity } from '@/server/activitypub/entity/user_actor';
import type { CalendarActor } from '@/server/activitypub/entity/calendar_actor';
import { InsufficientCalendarPermissionsError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { FederationDeliveryError } from '@/common/exceptions/activitypub';

const REMOTE_INBOX_URL = 'https://remote.example.com/inbox';
const USER_ACTOR_URI = 'https://pavillion.dev/users/test-user';

/**
 * Build a minimal CalendarActor (remote) for tests.
 */
function buildRemoteCalendarActor(inboxUrl: string | null = REMOTE_INBOX_URL): CalendarActor {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    actorType: 'remote',
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
 * Mock outbox service exposing only deliverActivitySigned. The publisher
 * accepts this via constructor injection (typed loosely as `any` in tests
 * to avoid wiring up the full ProcessOutboxService).
 */
function buildMockOutboxService() {
  return {
    deliverActivitySigned: sinon.stub().resolves({ status: 202, data: null }),
  };
}

describe('FederationPublisher', () => {

  describe('publishEventCreate', () => {
    let publisher: FederationPublisher;
    let sandbox: sinon.SinonSandbox;
    let calendarInterface: CalendarInterface;
    let mockOutbox: ReturnType<typeof buildMockOutboxService>;
    let userActorFindOneStub: sinon.SinonStub;
    let account: Account;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      const eventBus = new EventEmitter();
      calendarInterface = new CalendarInterface(eventBus);
      mockOutbox = buildMockOutboxService();
      publisher = new FederationPublisher(eventBus, calendarInterface, mockOutbox as any);
      account = Account.fromObject({ id: 'account-123' });

      // The publisher resolves the user actor URI directly via
      // UserActorEntity.findOne (it lives in the AP domain and shouldn't
      // call back through ActivityPubInterface).
      userActorFindOneStub = sandbox.stub(UserActorEntity, 'findOne');
      userActorFindOneStub.resolves({ actor_uri: USER_ACTOR_URI } as any);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('signs Create delivery with the user actor URI matching activity.actor', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      mockOutbox.deliverActivitySigned.resolves({ status: 202, data: null });

      await publisher.publishEventCreate(
        account,
        { eventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', eventParams },
        remoteCalendarActor,
      );

      expect(mockOutbox.deliverActivitySigned.calledOnce).toBe(true);
      const [signingActorUri, activityArg, inboxUrlArg] = mockOutbox.deliverActivitySigned.firstCall.args;
      // Per pv-dyyw signing-actor table: Create signs with the user actor URI,
      // which must equal the activity's `actor` field so the keyId is valid
      // at the receiver.
      expect(signingActorUri).toBe(USER_ACTOR_URI);
      expect(activityArg.actor).toBe(USER_ACTOR_URI);
      expect(activityArg.type).toBe('Create');
      expect(activityArg.id).toMatch(/^https:\/\/.+\/activities\/[a-f0-9-]+$/);
      expect(activityArg.to).toEqual([remoteCalendarActor.actorUri]);
      expect(activityArg.object.type).toBe('Event');
      expect(activityArg.object.calendarId).toBe(remoteCalendarActor.id);
      expect(activityArg['@context']).toBe('https://www.w3.org/ns/activitystreams');
      expect(inboxUrlArg).toBe(REMOTE_INBOX_URL);
    });

    it('returns CalendarEvent built from remote response data when 2xx with id', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
        start_date: '2026-03-01',
        start_time: '10:00',
      };

      const remoteEventId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      mockOutbox.deliverActivitySigned.resolves({
        status: 200,
        data: {
          id: remoteEventId,
          calendarId: remoteCalendarActor.id,
        },
      });

      const result = await publisher.publishEventCreate(
        account,
        { eventId: remoteEventId, eventParams },
        remoteCalendarActor,
      );
      expect(result.id).toBe(remoteEventId);
    });

    it('falls back to a synthetic event when response.data is null (empty 202)', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
      };
      const eventId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

      mockOutbox.deliverActivitySigned.resolves({ status: 202, data: null });

      const result = await publisher.publishEventCreate(
        account,
        { eventId, eventParams },
        remoteCalendarActor,
      );
      // Fallback contract: synthetic CalendarEvent reuses the local event id.
      expect(result.id).toBe(eventId);
      expect(result.calendarId).toBe(remoteCalendarActor.id);
    });

    it('falls back when response.data is non-null but has no id', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
      };
      const eventId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

      mockOutbox.deliverActivitySigned.resolves({ status: 200, data: {} });

      const result = await publisher.publishEventCreate(
        account,
        { eventId, eventParams },
        remoteCalendarActor,
      );
      // Fallback contract: synthetic CalendarEvent reuses the local event id.
      expect(result.id).toBe(eventId);
      expect(result.calendarId).toBe(remoteCalendarActor.id);
    });

    it('throws InsufficientCalendarPermissionsError when remote returns 403', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
      };

      mockOutbox.deliverActivitySigned.resolves({ status: 403, data: null });

      await expect(
        publisher.publishEventCreate(
          account,
          { eventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', eventParams },
          remoteCalendarActor,
        ),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('throws a generic error for other non-2xx statuses', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
      };

      mockOutbox.deliverActivitySigned.resolves({ status: 500, data: null });

      await expect(
        publisher.publishEventCreate(
          account,
          { eventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', eventParams },
          remoteCalendarActor,
        ),
      ).rejects.toThrow(/Failed to create event on remote calendar/);
    });

    it('wraps FederationDeliveryError thrown by the outbox helper as a generic error', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
      };

      mockOutbox.deliverActivitySigned.rejects(
        new FederationDeliveryError('Network failure delivering to remote inbox'),
      );

      await expect(
        publisher.publishEventCreate(
          account,
          { eventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', eventParams },
          remoteCalendarActor,
        ),
      ).rejects.toThrow(/Failed to create event on remote calendar/);
    });

    it('throws InsufficientCalendarPermissionsError when no user actor exists for account', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
      };

      // No UserActor row exists for this account.
      userActorFindOneStub.resolves(null);

      await expect(
        publisher.publishEventCreate(
          account,
          { eventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', eventParams },
          remoteCalendarActor,
        ),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('throws CalendarNotFoundError when remote calendar inbox URL is missing', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(null);
      const eventParams = {
        content: { en: { name: 'Test Event', description: 'Test description' } },
      };

      await expect(
        publisher.publishEventCreate(
          account,
          { eventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', eventParams },
          remoteCalendarActor,
        ),
      ).rejects.toThrow(CalendarNotFoundError);
    });
  });

  describe('publishEventUpdate', () => {
    let publisher: FederationPublisher;
    let sandbox: sinon.SinonSandbox;
    let calendarInterface: CalendarInterface;
    let mockOutbox: ReturnType<typeof buildMockOutboxService>;
    let editableCalendarsStub: sinon.SinonStub;
    let addToOutboxStub: sinon.SinonStub;
    let userActorFindOneStub: sinon.SinonStub;
    let account: Account;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      const eventBus = new EventEmitter();
      calendarInterface = new CalendarInterface(eventBus);
      mockOutbox = buildMockOutboxService();
      publisher = new FederationPublisher(eventBus, calendarInterface, mockOutbox as any);
      account = Account.fromObject({ id: 'account-123' });

      userActorFindOneStub = sandbox.stub(UserActorEntity, 'findOne');
      userActorFindOneStub.resolves({ actor_uri: USER_ACTOR_URI } as any);

      // Default: account has one editable local calendar to anchor the outbox row.
      editableCalendarsStub = sandbox.stub(calendarInterface, 'editableCalendarsForUser');
      editableCalendarsStub.resolves([Calendar.fromObject({ id: 'local-cal-id', urlName: 'local_cal' })]);

      // Stub the publisher's addToOutbox seam (mirrors members.test.ts pattern).
      // The thin wrapper around the module-level outbox helper exists precisely
      // so tests can intercept enqueues without a database.
      addToOutboxStub = sandbox.stub(publisher, 'addToOutbox');
      addToOutboxStub.resolves();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('enqueues an Update activity with explicit `to` targeting the remote actor', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventId = '11111111-1111-4111-8111-111111111111';
      const eventParams = {
        content: { en: { name: 'Updated Event', description: 'Updated description' } },
        start_date: '2026-03-02',
        start_time: '11:00',
      };

      await publisher.publishEventUpdate(account, { eventId, eventParams }, remoteCalendarActor);

      expect(addToOutboxStub.calledOnce).toBe(true);
      const [calendarArg, activityArg] = addToOutboxStub.firstCall.args;
      // userCalendars[0] anchors the outbox row (calendar_id FK).
      expect(calendarArg.id).toBe('local-cal-id');
      expect(activityArg.type).toBe('Update');
      // Signing actor: user actor (per pv-dyyw signing table).
      expect(activityArg.actor).toBe(USER_ACTOR_URI);
      expect(activityArg.id).toMatch(/^https:\/\/.+\/activities\/[a-f0-9-]+$/);
      // Explicit single-recipient delivery — outbox worker honors `to` and
      // skips follower fan-out for Update activities.
      expect(activityArg.to).toEqual([remoteCalendarActor.actorUri]);
    });

    it('preserves the local event id in eventParams (for remote lookup)', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventId = '11111111-1111-4111-8111-111111111111';
      const eventParams = {
        content: { en: { name: 'Updated Event', description: 'Updated description' } },
      };

      await publisher.publishEventUpdate(account, { eventId, eventParams }, remoteCalendarActor);

      const [, activityArg] = addToOutboxStub.firstCall.args;
      // The wire format embeds the local event id on the activity object so
      // the remote can resolve which event to update (per events.ts:572).
      expect(activityArg.object.eventParams.id).toBe(eventId);
    });

    it('throws InsufficientCalendarPermissionsError when account has no editable local calendar', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventId = '11111111-1111-4111-8111-111111111111';
      const eventParams = {
        content: { en: { name: 'Updated Event', description: 'Updated description' } },
      };

      // No local calendar to anchor the outbox row.
      editableCalendarsStub.resolves([]);

      await expect(
        publisher.publishEventUpdate(account, { eventId, eventParams }, remoteCalendarActor),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);

      expect(addToOutboxStub.called).toBe(false);
    });

    it('throws CalendarNotFoundError when remote calendar inbox URL is missing', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(null);
      const eventId = '11111111-1111-4111-8111-111111111111';
      const eventParams = {
        content: { en: { name: 'Updated Event', description: 'Updated description' } },
      };

      await expect(
        publisher.publishEventUpdate(account, { eventId, eventParams }, remoteCalendarActor),
      ).rejects.toThrow(CalendarNotFoundError);

      expect(addToOutboxStub.called).toBe(false);
    });

    it('throws InsufficientCalendarPermissionsError when account has no user actor', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventId = '11111111-1111-4111-8111-111111111111';
      const eventParams = {
        content: { en: { name: 'Updated Event', description: 'Updated description' } },
      };

      userActorFindOneStub.resolves(null);

      await expect(
        publisher.publishEventUpdate(account, { eventId, eventParams }, remoteCalendarActor),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);

      expect(addToOutboxStub.called).toBe(false);
    });
  });

  describe('publishEventDelete', () => {
    let publisher: FederationPublisher;
    let sandbox: sinon.SinonSandbox;
    let calendarInterface: CalendarInterface;
    let mockOutbox: ReturnType<typeof buildMockOutboxService>;
    let editableCalendarsStub: sinon.SinonStub;
    let addToOutboxStub: sinon.SinonStub;
    let userActorFindOneStub: sinon.SinonStub;
    let account: Account;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      const eventBus = new EventEmitter();
      calendarInterface = new CalendarInterface(eventBus);
      mockOutbox = buildMockOutboxService();
      publisher = new FederationPublisher(eventBus, calendarInterface, mockOutbox as any);
      account = Account.fromObject({ id: 'account-123' });

      userActorFindOneStub = sandbox.stub(UserActorEntity, 'findOne');
      userActorFindOneStub.resolves({ actor_uri: USER_ACTOR_URI } as any);

      editableCalendarsStub = sandbox.stub(calendarInterface, 'editableCalendarsForUser');
      editableCalendarsStub.resolves([Calendar.fromObject({ id: 'local-cal-id', urlName: 'local_cal' })]);

      addToOutboxStub = sandbox.stub(publisher, 'addToOutbox');
      addToOutboxStub.resolves();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('enqueues a Delete activity with a Tombstone object and explicit `to`', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventId = '22222222-2222-4222-8222-222222222222';

      await publisher.publishEventDelete(account, eventId, remoteCalendarActor);

      expect(addToOutboxStub.calledOnce).toBe(true);
      const [calendarArg, activityArg] = addToOutboxStub.firstCall.args;
      expect(calendarArg.id).toBe('local-cal-id');
      expect(activityArg.type).toBe('Delete');
      expect(activityArg.actor).toBe(USER_ACTOR_URI);
      expect(activityArg.id).toMatch(/^https:\/\/.+\/activities\/[a-f0-9-]+$/);
      expect(activityArg.to).toEqual([remoteCalendarActor.actorUri]);
      // The Tombstone object preserves formerType and the local eventId
      // so the remote can resolve which event to tombstone.
      expect(activityArg.object.type).toBe('Tombstone');
      expect(activityArg.object.formerType).toBe('Event');
      expect(activityArg.object.eventId).toBe(eventId);
    });

    it('throws InsufficientCalendarPermissionsError when account has no editable local calendar', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventId = '22222222-2222-4222-8222-222222222222';

      editableCalendarsStub.resolves([]);

      await expect(
        publisher.publishEventDelete(account, eventId, remoteCalendarActor),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);

      expect(addToOutboxStub.called).toBe(false);
    });

    it('throws CalendarNotFoundError when remote calendar inbox URL is missing', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor(null);
      const eventId = '22222222-2222-4222-8222-222222222222';

      await expect(
        publisher.publishEventDelete(account, eventId, remoteCalendarActor),
      ).rejects.toThrow(CalendarNotFoundError);

      expect(addToOutboxStub.called).toBe(false);
    });

    it('throws InsufficientCalendarPermissionsError when account has no user actor', async () => {
      const remoteCalendarActor = buildRemoteCalendarActor();
      const eventId = '22222222-2222-4222-8222-222222222222';

      // resolveUserActorUri returns null when no UserActor row exists for the account.
      userActorFindOneStub.resolves(null);

      await expect(
        publisher.publishEventDelete(account, eventId, remoteCalendarActor),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);

      expect(addToOutboxStub.called).toBe(false);
    });
  });

  describe('sendEditorInvite', () => {
    let publisher: FederationPublisher;
    let sandbox: sinon.SinonSandbox;
    let calendarInterface: CalendarInterface;
    let mockOutbox: ReturnType<typeof buildMockOutboxService>;
    let addToOutboxStub: sinon.SinonStub;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      const eventBus = new EventEmitter();
      calendarInterface = new CalendarInterface(eventBus);
      mockOutbox = buildMockOutboxService();
      publisher = new FederationPublisher(eventBus, calendarInterface, mockOutbox as any);

      addToOutboxStub = sandbox.stub(publisher, 'addToOutbox');
      addToOutboxStub.resolves();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('enqueues an Add activity signed by the calendar actor (not user actor)', async () => {
      const calendar = Calendar.fromObject({ id: 'local-cal-id', urlName: 'mycal' });
      const remoteUserActor = {
        actorUri: 'https://remote.example.com/users/alice',
        inbox: 'https://remote.example.com/users/alice/inbox',
      };

      await publisher.sendEditorInvite(calendar, remoteUserActor);

      expect(addToOutboxStub.calledOnce).toBe(true);
      const [calendarArg, activityArg] = addToOutboxStub.firstCall.args;
      // Anchor calendar = the calendar argument directly (calendar actor's
      // own outbox).
      expect(calendarArg).toBe(calendar);
      expect(activityArg.type).toBe('Add');
      // Signing actor: calendar actor URI (per pv-dyyw signing table).
      expect(activityArg.actor).toMatch(/^https:\/\/.+\/calendars\/mycal$/);
      // Activity id is calendar-actor-rooted for Add.
      expect(activityArg.id).toMatch(/^https:\/\/.+\/calendars\/mycal\/activities\/[a-f0-9-]+$/);
      expect(activityArg.to).toEqual([remoteUserActor.actorUri]);
      expect(activityArg.object).toBe(remoteUserActor.actorUri);
      // calendarId / calendarInboxUrl are non-standard Pavillion extension
      // fields the receiving user actor inbox uses to record the invite.
      expect(activityArg.calendarId).toBe(calendar.id);
      expect(activityArg.calendarInboxUrl).toMatch(/^https:\/\/.+\/calendars\/mycal\/inbox$/);
    });
  });

});
