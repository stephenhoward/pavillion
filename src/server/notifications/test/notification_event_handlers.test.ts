import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';

import db from '@/server/common/entity/db';
import { AccountEntity } from '@/server/common/entity/account';
import NotificationEventHandlers from '@/server/notifications/events';
import NotificationService, {
  type ResolveRoleAudienceFn,
} from '@/server/notifications/service/notification';
import {
  NotificationActivityEntity,
  NotificationRecipientEntity,
} from '@/server/notifications/entity/notification_activity';
import type CalendarInterface from '@/server/calendar/interface';
import type AccountsInterface from '@/server/accounts/interface';
import { Account } from '@/common/model/account';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import { emitAndSettle } from '@/server/common/test/helpers/emit-and-settle';

/**
 * Tests for `NotificationEventHandlers` (pv-89mw.5.1).
 *
 * This class is the
 * single subscriber that routes seven cross-domain bus events to the
 * write-path service. Tests run against a real SQLite :memory: database
 * so assertions can target the persisted row state (verb, origin, object,
 * audience members) rather than stub call counts — the bead's argument-
 * level-assertion requirement.
 *
 * The suite does not import `server.ts` (which transitively pulls in
 * later-bead modules); the DB is sync'd directly, the same pattern the
 * record-activity / dismiss-for-object integration suites use.
 */
describe('NotificationEventHandlers', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: NotificationService;
  let calendarInterface: CalendarInterface;
  let accountsInterface: AccountsInterface;
  let handlers: NotificationEventHandlers;
  let getEditorsStub: sinon.SinonStub;
  let getOwnersStub: sinon.SinonStub;
  let getInstanceAdminsStub: sinon.SinonStub;
  let getCalendarStub: sinon.SinonStub;
  let getCalendarByNameStub: sinon.SinonStub;
  let getEventByIdStub: sinon.SinonStub;
  let getAccountByIdStub: sinon.SinonStub;

  beforeAll(async () => {
    await db.sync({ force: true });
  });

  beforeEach(async () => {
    // Clear notification tables in dependent order so dedup-window
    // calculations work against a known state across describe-blocks.
    await NotificationRecipientEntity.destroy({ where: {}, truncate: true });
    await NotificationActivityEntity.destroy({ where: {}, truncate: true });
    await AccountEntity.destroy({ where: {}, truncate: true, cascade: true });

    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();

    // Closure-based role resolver — overridden per-test via getEditorsStub /
    // getOwnersStub / getInstanceAdminsStub. Real role resolution is covered
    // by the role-resolver integration test; here we focus on the handler
    // wiring and the per-handler audience-shape decisions.
    //
    // The interface also exposes `getCalendar` and `getEventById`, which
    // each handler calls to populate `object.label` via snapshot-on-write
    //. Defaults return null / a stub
    // event so tests exercise the lookup-failure fallback path (LABEL_
    // FALLBACK_*); tests that want a specific snapshot label override the
    // stub to return a populated Calendar / CalendarEvent model.
    calendarInterface = {
      getEditorsForCalendar: async (_calendarId: string): Promise<Account[]> => [],
      getOwnersForCalendar: async (_calendarId: string): Promise<Account[]> => [],
      getCalendar: async (_id: string): Promise<Calendar | null> => null,
      getCalendarByName: async (_name: string): Promise<Calendar | null> => null,
      getEventById: async (_id: string): Promise<CalendarEvent> => new CalendarEvent(),
    } as unknown as CalendarInterface;
    accountsInterface = {
      getInstanceAdmins: async (): Promise<string[]> => [],
      getAccountById: async (_id: string): Promise<Account | undefined> => undefined,
    } as unknown as AccountsInterface;

    getEditorsStub = sandbox.stub(calendarInterface, 'getEditorsForCalendar');
    getOwnersStub = sandbox.stub(calendarInterface, 'getOwnersForCalendar');
    getInstanceAdminsStub = sandbox.stub(accountsInterface, 'getInstanceAdmins');
    getCalendarStub = sandbox.stub(calendarInterface, 'getCalendar');
    getCalendarByNameStub = sandbox.stub(calendarInterface, 'getCalendarByName');
    getEventByIdStub = sandbox.stub(calendarInterface, 'getEventById');
    getAccountByIdStub = sandbox.stub(accountsInterface, 'getAccountById');
    // Default empty resolutions; individual tests override.
    getEditorsStub.resolves([]);
    getOwnersStub.resolves([]);
    getInstanceAdminsStub.resolves([]);
    // Defaults for the label lookups: return null / an empty CalendarEvent
    // so the handler falls back to the generic LABEL_FALLBACK_* string.
    // Tests that want a named label override these.
    getCalendarStub.resolves(null);
    getCalendarByNameStub.resolves(null);
    getEventByIdStub.resolves(new CalendarEvent());
    // Default account lookup: undefined (lookup miss). Tests that need
    // the granting/revoking actor's display name override this.
    getAccountByIdStub.resolves(undefined);

    // The notification service runs against the real DB. Inject a role
    // resolver that consults the same stubbed interfaces the handler
    // uses for its explicit-audience cases — this keeps the role-based
    // audience tests consistent with the handler's behaviour.
    const resolveRoleAudienceFn: ResolveRoleAudienceFn = async (role, objectRef) => {
      if (role === 'calendar-editors' && objectRef !== undefined) {
        const editors = await calendarInterface.getEditorsForCalendar(objectRef.id);
        return editors.map(a => a.id);
      }
      if (role === 'calendar-owners' && objectRef !== undefined) {
        const owners = await calendarInterface.getOwnersForCalendar(objectRef.id);
        return owners.map(a => a.id);
      }
      if (role === 'instance-admins') {
        return accountsInterface.getInstanceAdmins();
      }
      return [];
    };
    service = new NotificationService(
      { calendarInterface, accountsInterface },
      resolveRoleAudienceFn,
    );

    handlers = new NotificationEventHandlers(service, calendarInterface, accountsInterface);
    handlers.install(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
    eventBus.removeAllListeners();
  });

  /**
   * Seed N accounts and return their IDs. Convenience for tests that need
   * real account rows because `notification_recipient.account_id` has an
   * FK constraint on the accounts table.
   */
  async function seedAccounts(count: number, prefix: string = 'handler'): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = uuidv4();
      await AccountEntity.create({
        id,
        username: `${prefix}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        email: `${prefix}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@pavillion.dev`,
        language: 'en',
      });
      ids.push(id);
    }
    return ids;
  }

  /**
   * Local-scope wrapper around the shared `emitAndSettle` helper. Tests in
   * this file call `emit(event, payload)` without threading the bus instance
   * through every call site — close over `eventBus` once here.
   *
   * The handler runs an async DB transaction (`recordActivity` uses
   * SERIALIZABLE isolation + a retry loop). The shared helper's default
   * drain (5 rounds × 5ms gap) is sufficient.
   */
  async function emit(event: string, payload: unknown): Promise<void> {
    await emitAndSettle(eventBus, event, payload);
  }

  /**
   * Build a {@link Calendar} model with a single language's name populated
   * so {@link TranslatedModel.displayName} produces a deterministic snapshot
   * label.
   */
  function makeCalendar(id: string, language: string, name: string): Calendar {
    const calendar = new Calendar(id);
    calendar.addContent(new CalendarContent(language, name));
    return calendar;
  }

  /**
   * Build a {@link CalendarEvent} model with a single language's title
   * populated.
   */
  function makeEvent(id: string, language: string, name: string): CalendarEvent {
    const event = new CalendarEvent(id);
    event.addContent(new CalendarEventContent(language, name));
    return event;
  }

  /**
   * Build an {@link Account} model with a populated displayName. Used by
   * EditorInvited / EditorRevoked snapshot tests where the
   * granting/revoking account's display name must reach the persisted row.
   */
  function makeAccount(id: string, displayName: string | null): Account {
    const account = new Account(id, `user-${id.slice(0, 6)}`, `user-${id.slice(0, 6)}@pavillion.dev`);
    account.displayName = displayName;
    return account;
  }

  // ---------------------------------------------------------------------------
  // install
  // ---------------------------------------------------------------------------

  describe('install', () => {
    it('subscribes to all seven bus events', () => {
      expect(eventBus.listenerCount('activitypub:calendar:followed')).toBe(1);
      expect(eventBus.listenerCount('activitypub:event:reposted')).toBe(1);
      expect(eventBus.listenerCount('moderation:report:flagged')).toBe(1);
      expect(eventBus.listenerCount('moderation:report:escalated')).toBe(1);
      expect(eventBus.listenerCount('moderation:report:resolved')).toBe(1);
      expect(eventBus.listenerCount('calendar:editor:invited')).toBe(1);
      expect(eventBus.listenerCount('calendar:editor:revoked')).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // AP Follow — argument-level assertions on the persisted Activity row
  // ---------------------------------------------------------------------------

  describe('activitypub:calendar:followed', () => {
    it('records a Follow activity with origin=federated, object=calendar, audience=calendar-editors', async () => {
      const [editorA, editorB] = await seedAccounts(2, 'follow-editor');
      const editorAccountA = new Account(editorA, 'editorA', 'editorA@pavillion.dev');
      const editorAccountB = new Account(editorB, 'editorB', 'editorB@pavillion.dev');
      getEditorsStub.resolves([editorAccountA, editorAccountB]);

      const calendarId = uuidv4();
      const followerUrl = 'https://remote.example.com/users/alice';

      await emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Alice',
        followerUrl,
      });

      const activities = await NotificationActivityEntity.findAll({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activities).toHaveLength(1);
      const activity = activities[0];
      expect(activity.verb).toBe('Follow');
      expect(activity.origin).toBe('federated');
      expect(activity.object_type).toBe('calendar');
      expect(activity.object_id).toBe(calendarId);
      expect(activity.actor_kind).toBe('remote_actor');
      expect(activity.actor_uri).toBe(followerUrl);

      // Audience members are exactly the seeded editors.
      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity.id },
      });
      const recipientIds = recipients.map(r => r.account_id).sort();
      expect(recipientIds).toEqual([editorA, editorB].sort());
    });

    it('inserts the activity row even when the calendar has no editors', async () => {
      // Empty-audience contract:
      // activity row to be persisted for the audit trail; zero recipients.
      getEditorsStub.resolves([]);

      const calendarId = uuidv4();
      await emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Alice',
        followerUrl: 'https://remote.example.com/users/alice',
      });

      const activities = await NotificationActivityEntity.findAll({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activities).toHaveLength(1);
      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activities[0].id },
      });
      expect(recipients).toHaveLength(0);
    });

    it('does not rethrow when the role resolver fails', async () => {
      // Notifications is a side-effect consumer — a downstream failure
      // must never surface back to the bus emitter.
      getEditorsStub.rejects(new Error('boom'));

      await emit('activitypub:calendar:followed', {
        calendarId: uuidv4(),
        followerName: 'Alice',
        followerUrl: 'https://remote.example.com/users/alice',
      });
    });

    // -------------------------------------------------------------------------
    // Local-follow display-name resolution (pv-d84j.1)
    //
    // Local follows round-trip through the same instance's AP inbox, so the
    // bus payload's `followerName` arrives as the calendar-actor URI. The
    // handler must detect that URI shape, look up the local calendar by
    // its urlName, and override `actor_display_name` with the calendar's
    // display name so the inbox does not render a raw URL.
    // -------------------------------------------------------------------------

    it('resolves a local calendar-actor URL to the followed calendar display name (pv-d84j.1)', async () => {
      const calendarId = uuidv4();
      const followerCalendarId = uuidv4();
      const followerUrl = 'https://pavillion.dev/calendars/community-org';
      // The local-follow case: AP emitter pushes the calendar-actor URI as
      // both followerName and followerUrl. The handler resolves the urlName
      // via getCalendarByName and overrides actor_display_name.
      getCalendarByNameStub.withArgs('community-org').resolves(
        makeCalendar(followerCalendarId, 'en', 'Community Org'),
      );

      await emit('activitypub:calendar:followed', {
        calendarId,
        followerName: followerUrl,
        followerUrl,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.actor_display_name).toBe('Community Org');
      // Identity columns are unchanged — the actor is still the AP URI.
      expect(activity!.actor_kind).toBe('remote_actor');
      expect(activity!.actor_uri).toBe(followerUrl);
      expect(activity!.actor_display_url).toBe(followerUrl);
      expect(getCalendarByNameStub.calledWith('community-org')).toBe(true);
    });

    it('leaves remote-actor follows untouched (no urlName match attempts beyond pattern check)', async () => {
      // A remote `/users/<name>` actor URI does not match the local
      // calendar-actor pattern; the handler must not call
      // getCalendarByName at all and the payload-supplied followerName
      // is persisted as-is.
      const calendarId = uuidv4();
      await emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Alice',
        followerUrl: 'https://remote.example.com/users/alice',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.actor_display_name).toBe('Alice');
      expect(getCalendarByNameStub.called).toBe(false);
    });

    it('falls back to followerName when the local calendar-actor URL does not resolve', async () => {
      // The URI matches the local pattern but getCalendarByName misses
      // (deleted calendar, race window, or actor URI from another
      // instance that happens to share the path layout). The handler
      // must not blow up; the original followerName (the URI itself,
      // for the local-follow case) is persisted.
      const calendarId = uuidv4();
      const followerUrl = 'https://pavillion.dev/calendars/unknown-cal';
      getCalendarByNameStub.withArgs('unknown-cal').resolves(null);

      await emit('activitypub:calendar:followed', {
        calendarId,
        followerName: followerUrl,
        followerUrl,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.actor_display_name).toBe(followerUrl);
    });

    it('falls back to followerName when the local calendar has no populated display name', async () => {
      // A Calendar with only `urlName` populated and no content rows
      // resolves to an empty displayName(); the handler treats this as
      // a miss and keeps the original payload-supplied followerName.
      const calendarId = uuidv4();
      const followerUrl = 'https://pavillion.dev/calendars/nameless-cal';
      getCalendarByNameStub.withArgs('nameless-cal').resolves(new Calendar(uuidv4()));

      await emit('activitypub:calendar:followed', {
        calendarId,
        followerName: followerUrl,
        followerUrl,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.actor_display_name).toBe(followerUrl);
    });

    it('falls back to followerName when the local calendar lookup throws', async () => {
      // Lookup failures must never surface to the bus emitter, and the
      // snapshot must still persist with whatever the payload supplied.
      const calendarId = uuidv4();
      const followerUrl = 'https://pavillion.dev/calendars/throws';
      getCalendarByNameStub.withArgs('throws').rejects(new Error('db down'));

      await emit('activitypub:calendar:followed', {
        calendarId,
        followerName: followerUrl,
        followerUrl,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.actor_display_name).toBe(followerUrl);
    });

    it('rejects a remote-host URI whose path collides with a local urlName (impersonation guard)', async () => {
      // Security regression: a remote actor URI
      // `https://attacker.example/calendars/<localUrlName>` matches the
      // path shape but the host is NOT the local instance domain. The
      // resolver must reject the URI before any lookup runs — otherwise
      // the snapshot's actor_display_name would be overwritten with the
      // local calendar's display name while actor_display_url still
      // points at the attacker's host, creating a misattribution vector.
      const calendarId = uuidv4();
      const followerUrl = 'https://attacker.example/calendars/community-org';
      // If the host check is missing, the resolver would call this and
      // overwrite the display name to 'Community Org'. The assertion
      // below proves the lookup is never reached.
      getCalendarByNameStub.withArgs('community-org').resolves(
        makeCalendar(uuidv4(), 'en', 'Community Org'),
      );

      await emit('activitypub:calendar:followed', {
        calendarId,
        followerName: followerUrl,
        followerUrl,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      // Display name remains the raw URI — no impersonation by a remote
      // host that happens to expose a `/calendars/<x>` path.
      expect(activity!.actor_display_name).toBe(followerUrl);
      expect(getCalendarByNameStub.called).toBe(false);
    });

    it('rejects an http:// URI on the local host (local actors are minted as https)', async () => {
      // `CalendarActorService.createActor` always mints
      // `https://${domain}/calendars/${urlName}`. An `http://` URI is
      // therefore never a legitimate local actor — treat it as remote.
      const calendarId = uuidv4();
      const followerUrl = 'http://pavillion.dev/calendars/community-org';
      getCalendarByNameStub.withArgs('community-org').resolves(
        makeCalendar(uuidv4(), 'en', 'Community Org'),
      );

      await emit('activitypub:calendar:followed', {
        calendarId,
        followerName: followerUrl,
        followerUrl,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.actor_display_name).toBe(followerUrl);
      expect(getCalendarByNameStub.called).toBe(false);
    });

    it('does not throw when the actor URI is malformed', async () => {
      // A non-parseable URI must be rejected silently — the handler
      // wraps the bus event in a try/catch, but the resolver itself
      // also needs to swallow `new URL()` parse failures so unrelated
      // emission paths are not affected.
      const calendarId = uuidv4();
      const followerUrl = 'not a url';

      await emit('activitypub:calendar:followed', {
        calendarId,
        followerName: followerUrl,
        followerUrl,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.actor_display_name).toBe(followerUrl);
      expect(getCalendarByNameStub.called).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // AP Announce — argument-level assertions on the persisted Activity row
  // ---------------------------------------------------------------------------

  describe('activitypub:event:reposted', () => {
    it('records an Announce activity with origin=federated, object=event, audience=calendar-editors', async () => {
      const [editorA] = await seedAccounts(1, 'repost-editor');
      const editorAccount = new Account(editorA, 'editorA', 'editorA@pavillion.dev');
      getEditorsStub.resolves([editorAccount]);

      const eventId = uuidv4();
      const calendarId = uuidv4();
      const reposterUrl = 'https://remote.example.com/users/bob';

      await emit('activitypub:event:reposted', {
        eventId,
        calendarId,
        reposterName: 'Bob',
        reposterUrl,
      });

      const activities = await NotificationActivityEntity.findAll({
        where: { verb: 'Announce', object_id: eventId },
      });
      expect(activities).toHaveLength(1);
      const activity = activities[0];
      expect(activity.verb).toBe('Announce');
      expect(activity.origin).toBe('federated');
      expect(activity.object_type).toBe('event');
      expect(activity.object_id).toBe(eventId);
      expect(activity.actor_kind).toBe('remote_actor');
      expect(activity.actor_uri).toBe(reposterUrl);

      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity.id },
      });
      expect(recipients.map(r => r.account_id)).toEqual([editorA]);

      // The handler should ask for editors of the announced event's
      // calendar — not the event itself.
      expect(getEditorsStub.calledWith(calendarId)).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Local-repost paths (pv-d84j.2)
    //
    // When the reposter is a local calendar (manual share or auto-repost),
    // the emitter passes `reposterCalendarId` and the calendar-actor URI as
    // both reposterName and reposterUrl. The handler must:
    //   1. Resolve the URI to the reposter's calendar display name (parallels
    //      pv-d84j.1).
    //   2. Subtract the reposter's editors from the source-calendar editors
    //      so the reposter does not receive their own Announce.
    // -------------------------------------------------------------------------

    it('records an Announce for a local repost with reposter calendar display name (pv-d84j.2)', async () => {
      const [editorA] = await seedAccounts(1, 'localrepost-editor');
      const sourceCalendarId = uuidv4();
      const reposterCalendarId = uuidv4();
      const reposterUrl = 'https://pavillion.dev/calendars/reposter-cal';

      // Source-calendar editors include editorA; reposter-calendar editors
      // empty so no exclusion fires.
      getEditorsStub.withArgs(sourceCalendarId).resolves([
        new Account(editorA, 'editorA', 'editorA@pavillion.dev'),
      ]);
      getEditorsStub.withArgs(reposterCalendarId).resolves([]);
      getCalendarByNameStub.withArgs('reposter-cal').resolves(
        makeCalendar(reposterCalendarId, 'en', 'Reposter Calendar'),
      );

      const eventId = uuidv4();
      await emit('activitypub:event:reposted', {
        eventId,
        calendarId: sourceCalendarId,
        reposterName: reposterUrl,
        reposterUrl,
        reposterCalendarId,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Announce', object_id: eventId },
      });
      expect(activity).not.toBeNull();
      // Display name was resolved from the calendar-actor URI rather than
      // persisted as the raw URI.
      expect(activity!.actor_display_name).toBe('Reposter Calendar');
      expect(activity!.actor_uri).toBe(reposterUrl);

      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity!.id },
      });
      expect(recipients.map(r => r.account_id)).toEqual([editorA]);
    });

    it('excludes the reposting calendar editors from the source-calendar audience on local repost (pv-d84j.2)', async () => {
      // The acceptance scenario: the reposter is an editor of the source
      // calendar (e.g. MultiCalendarTestUser editing both calendars). The
      // shared editor must NOT receive their own Announce notification.
      const [sharedEditor, sourceOnlyEditor] = await seedAccounts(2, 'localrepost-overlap');
      const sourceCalendarId = uuidv4();
      const reposterCalendarId = uuidv4();
      const reposterUrl = 'https://pavillion.dev/calendars/reposter-cal';

      const sharedEditorAccount = new Account(sharedEditor, 'shared', 'shared@pavillion.dev');
      const sourceOnlyAccount = new Account(sourceOnlyEditor, 'sourceonly', 'sourceonly@pavillion.dev');

      // Source has both editors; reposter has only the shared editor.
      getEditorsStub.withArgs(sourceCalendarId).resolves([sharedEditorAccount, sourceOnlyAccount]);
      getEditorsStub.withArgs(reposterCalendarId).resolves([sharedEditorAccount]);

      const eventId = uuidv4();
      await emit('activitypub:event:reposted', {
        eventId,
        calendarId: sourceCalendarId,
        reposterName: reposterUrl,
        reposterUrl,
        reposterCalendarId,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Announce', object_id: eventId },
      });
      expect(activity).not.toBeNull();

      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity!.id },
      });
      // Only the source-only editor receives the row; the shared editor
      // (the reposter) is filtered out.
      expect(recipients.map(r => r.account_id)).toEqual([sourceOnlyEditor]);
    });

    it('leaves federated Announces unchanged when reposterCalendarId is omitted (pv-d84j.2 regression guard)', async () => {
      // The federated inbound path (inbox.ts:2179) does not pass
      // reposterCalendarId — the handler must fall through to the
      // role-based audience and never call getEditorsForCalendar twice.
      const [editorA] = await seedAccounts(1, 'fed-repost-regression');
      const calendarId = uuidv4();
      const editorAccount = new Account(editorA, 'editorA', 'editorA@pavillion.dev');
      getEditorsStub.withArgs(calendarId).resolves([editorAccount]);

      const eventId = uuidv4();
      await emit('activitypub:event:reposted', {
        eventId,
        calendarId,
        reposterName: 'Bob',
        reposterUrl: 'https://remote.example.com/users/bob',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Announce', object_id: eventId },
      });
      expect(activity).not.toBeNull();
      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity!.id },
      });
      expect(recipients.map(r => r.account_id)).toEqual([editorA]);
      // Remote actor URI should not match the local pattern, so the
      // payload-supplied reposterName persists unchanged.
      expect(activity!.actor_display_name).toBe('Bob');
      expect(getCalendarByNameStub.called).toBe(false);
    });

    it('rejects a federated Announce whose reposterUrl host is not the local instance (impersonation guard)', async () => {
      // Security regression: an inbound federated Announce arrives with
      // reposterUrl = `https://attacker.example/calendars/<localUrlName>`.
      // Without the host check, the resolver would look up
      // `localUrlName` and overwrite the snapshot's actor_display_name
      // with the local calendar's display name — a misattribution
      // vector identical to the Follow case.
      const [editorA] = await seedAccounts(1, 'fed-repost-impersonation');
      const calendarId = uuidv4();
      const editorAccount = new Account(editorA, 'editorA', 'editorA@pavillion.dev');
      getEditorsStub.withArgs(calendarId).resolves([editorAccount]);
      // If the host check is missing the resolver would call this and
      // overwrite the display name to 'Reposter Calendar'.
      getCalendarByNameStub.withArgs('reposter-cal').resolves(
        makeCalendar(uuidv4(), 'en', 'Reposter Calendar'),
      );

      const eventId = uuidv4();
      const reposterUrl = 'https://attacker.example/calendars/reposter-cal';
      await emit('activitypub:event:reposted', {
        eventId,
        calendarId,
        reposterName: reposterUrl,
        reposterUrl,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Announce', object_id: eventId },
      });
      expect(activity).not.toBeNull();
      // Display name must NOT be overridden to the local calendar's
      // name — the snapshot keeps whatever the federated payload sent.
      expect(activity!.actor_display_name).toBe(reposterUrl);
      expect(getCalendarByNameStub.called).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Local Flag flow — owner + admin recipient rows are inserted
  // ---------------------------------------------------------------------------

  describe('moderation:report:flagged', () => {
    it('records a Flag activity addressed to both calendar owners and instance admins', async () => {
      const [ownerA, adminA, adminB] = await seedAccounts(3, 'flag');
      const ownerAccount = new Account(ownerA, 'ownerA', 'ownerA@pavillion.dev');
      getOwnersStub.resolves([ownerAccount]);
      getInstanceAdminsStub.resolves([adminA, adminB]);

      const reportId = uuidv4();
      const calendarId = uuidv4();

      await emit('moderation:report:flagged', {
        reportId,
        eventId: uuidv4(),
        calendarId,
        origin: 'local',
      });

      const activities = await NotificationActivityEntity.findAll({
        where: { verb: 'Flag', object_id: reportId },
      });
      expect(activities).toHaveLength(1);
      const activity = activities[0];
      expect(activity.object_type).toBe('report');
      expect(activity.origin).toBe('local');
      // Flag anonymizer must have stripped identity columns regardless of
      // what the handler passed in. The actor_kind stays 'anonymous'.
      expect(activity.actor_kind).toBe('anonymous');
      expect(activity.actor_account_id).toBeNull();
      expect(activity.actor_uri).toBeNull();

      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity.id },
      });
      const recipientIds = recipients.map(r => r.account_id).sort();
      expect(recipientIds).toEqual([ownerA, adminA, adminB].sort());

      // The handler should ask owners for the calendarId on the payload.
      expect(getOwnersStub.calledWith(calendarId)).toBe(true);
      expect(getInstanceAdminsStub.calledOnce).toBe(true);
    });

    it('dedupes owners overlapping with admins to a single recipient row each', async () => {
      // Owner and admin may be the same account (e.g. an admin who also
      // owns the flagged calendar). The handler de-dupes the combined
      // list before passing to `recordActivity`.
      const [account] = await seedAccounts(1, 'flag-overlap');
      const accountModel = new Account(account, 'overlap', 'overlap@pavillion.dev');
      getOwnersStub.resolves([accountModel]);
      getInstanceAdminsStub.resolves([account]);

      const reportId = uuidv4();
      const calendarId = uuidv4();
      await emit('moderation:report:flagged', {
        reportId,
        eventId: uuidv4(),
        calendarId,
        origin: 'local',
      });

      const activities = await NotificationActivityEntity.findAll({
        where: { verb: 'Flag', object_id: reportId },
      });
      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activities[0].id },
      });
      expect(recipients.map(r => r.account_id)).toEqual([account]);
    });

    it('handles calendarId=null (admin-initiated report against remote event) by addressing admins only', async () => {
      const [adminA] = await seedAccounts(1, 'flag-noowner');
      getInstanceAdminsStub.resolves([adminA]);

      const reportId = uuidv4();
      await emit('moderation:report:flagged', {
        reportId,
        eventId: uuidv4(),
        calendarId: null,
        origin: 'local',
      });

      const activities = await NotificationActivityEntity.findAll({
        where: { verb: 'Flag', object_id: reportId },
      });
      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activities[0].id },
      });
      expect(recipients.map(r => r.account_id)).toEqual([adminA]);
      // Owner lookup must not have been called when calendarId is null.
      expect(getOwnersStub.called).toBe(false);
    });

    it('passes origin=federated through to the recorded activity row', async () => {
      const [adminA] = await seedAccounts(1, 'flag-fed');
      getInstanceAdminsStub.resolves([adminA]);

      const reportId = uuidv4();
      await emit('moderation:report:flagged', {
        reportId,
        eventId: uuidv4(),
        calendarId: null,
        origin: 'federated',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Flag', object_id: reportId },
      });
      expect(activity!.origin).toBe('federated');
    });

    it('stamps https://<host> attribution on the activity row when a federated Flag carries actorUri', async () => {
      // Flag rows from remote
      // instances must record `actor_display_url=https://<host>` so
      // clients can present the reporting instance link without
      // exposing the underlying actor URI. The anonymizer extracts
      // the host from `actorUri` and discards everything else.
      const [adminA] = await seedAccounts(1, 'flag-fed-uri');
      getInstanceAdminsStub.resolves([adminA]);

      const reportId = uuidv4();
      await emit('moderation:report:flagged', {
        reportId,
        eventId: uuidv4(),
        calendarId: null,
        origin: 'federated',
        actorUri: 'https://remote.example/calendars/reporter',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Flag', object_id: reportId },
      });
      expect(activity).not.toBeNull();
      // Anonymization invariants for federated Flag with actorUri:
      // host-derived display URL is present, all identity fields null,
      // actor_kind anonymous.
      expect(activity!.actor_kind).toBe('anonymous');
      expect(activity!.actor_account_id).toBeNull();
      expect(activity!.actor_uri).toBeNull();
      expect(activity!.actor_display_url).toBe('https://remote.example');
    });

    it('falls back to anonymous (no display URL) when a federated Flag omits actorUri', async () => {
      // Backwards-compatible behaviour: a federated payload without
      // `actorUri` (legacy paths or admin actions that bypass the
      // inbox) yields the fully-anonymous form with no
      // `actor_display_url`.
      const [adminA] = await seedAccounts(1, 'flag-fed-nouri');
      getInstanceAdminsStub.resolves([adminA]);

      const reportId = uuidv4();
      await emit('moderation:report:flagged', {
        reportId,
        eventId: uuidv4(),
        calendarId: null,
        origin: 'federated',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Flag', object_id: reportId },
      });
      expect(activity!.actor_kind).toBe('anonymous');
      expect(activity!.actor_account_id).toBeNull();
      expect(activity!.actor_uri).toBeNull();
      expect(activity!.actor_display_url).toBeNull();
    });

    it('routes federated Flag owner lookup by calendar_id (not event_id) when a local calendar owns the flagged event', async () => {
      // "audience.object.id is the flagged event's
      // calendar_id (not the event_id)". The handler must call the owner
      // resolver with the calendarId from the payload, not the reportId
      // or any event identifier. This exercises the AP-inbound path where
      // a remote Flag targets a local event whose calendar we own — owner
      // notifications are required in addition to admin notifications.
      const [ownerA, ownerB, adminA] = await seedAccounts(3, 'flag-fed-cal');
      const ownerAccountA = new Account(ownerA, 'ownerA', 'ownerA@pavillion.dev');
      const ownerAccountB = new Account(ownerB, 'ownerB', 'ownerB@pavillion.dev');
      getOwnersStub.resolves([ownerAccountA, ownerAccountB]);
      getInstanceAdminsStub.resolves([adminA]);

      const reportId = uuidv4();
      const calendarId = uuidv4();
      await emit('moderation:report:flagged', {
        reportId,
        eventId: uuidv4(),
        calendarId,
        origin: 'federated',
      });

      // Owner resolver was called with the calendarId — not the reportId
      // and not any other identifier. This is the routing invariant.
      expect(getOwnersStub.calledWith(calendarId)).toBe(true);
      expect(getOwnersStub.calledWith(reportId)).toBe(false);

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Flag', object_id: reportId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.origin).toBe('federated');

      // Owner + admin recipient rows are inserted using the resolved
      // owner account_ids — proving the calendarId-keyed lookup actually
      // drives the audience.
      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity!.id },
      });
      const recipientIds = recipients.map(r => r.account_id).sort();
      expect(recipientIds).toEqual([ownerA, ownerB, adminA].sort());
    });
  });

  // ---------------------------------------------------------------------------
  // ReportEscalated — addressed to instance admins
  // ---------------------------------------------------------------------------

  describe('moderation:report:escalated', () => {
    it('records a ReportEscalated activity addressed to instance-admins', async () => {
      const [adminA, adminB] = await seedAccounts(2, 'esc');
      getInstanceAdminsStub.resolves([adminA, adminB]);

      const reportId = uuidv4();
      await emit('moderation:report:escalated', {
        reportId,
        eventId: uuidv4(),
        calendarId: uuidv4(),
        reason: 'Auto-escalated due to inaction',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'ReportEscalated', object_id: reportId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.object_type).toBe('report');
      expect(activity!.actor_kind).toBe('system');

      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity!.id },
      });
      expect(recipients.map(r => r.account_id).sort()).toEqual([adminA, adminB].sort());
    });
  });

  // ---------------------------------------------------------------------------
  // ReportResolved — records ResolvedActivity AND dismisses prior Flag/Escalated
  // ---------------------------------------------------------------------------

  describe('moderation:report:resolved', () => {
    it('records a ReportResolved activity AND dismisses prior Flag recipient rows', async () => {
      // Seed a prior Flag activity with N admin recipient rows. None are
      // dismissed initially. Then emit resolved and assert (a) a new
      // ReportResolved activity exists, (b) the prior Flag's recipient
      // rows now have non-null dismissed_at.
      const [adminA, adminB, adminC] = await seedAccounts(3, 'res-admin');
      const [reviewerId] = await seedAccounts(1, 'res-reviewer');

      const reportId = uuidv4();
      const priorFlag = await NotificationActivityEntity.create({
        verb: 'Flag',
        origin: 'local',
        actor_kind: 'anonymous',
        actor_account_id: null,
        actor_uri: null,
        actor_display_name: 'Anonymous reporter',
        actor_display_url: null,
        object_type: 'report',
        object_id: reportId,
        object_label: 'Reported event',
      });
      await NotificationRecipientEntity.bulkCreate([
        { notification_activity_id: priorFlag.id, account_id: adminA },
        { notification_activity_id: priorFlag.id, account_id: adminB },
        { notification_activity_id: priorFlag.id, account_id: adminC },
      ]);

      await emit('moderation:report:resolved', {
        reportId,
        eventId: uuidv4(),
        calendarId: uuidv4(),
        reviewerId,
      });

      // (a) ReportResolved activity recorded.
      const resolved = await NotificationActivityEntity.findOne({
        where: { verb: 'ReportResolved', object_id: reportId },
      });
      expect(resolved).not.toBeNull();
      expect(resolved!.object_type).toBe('report');
      const resolvedRecipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: resolved!.id },
      });
      expect(resolvedRecipients.map(r => r.account_id)).toEqual([reviewerId]);

      // (b) Prior Flag recipients are dismissed.
      const flagRecipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: priorFlag.id },
      });
      expect(flagRecipients).toHaveLength(3);
      for (const r of flagRecipients) {
        expect(r.dismissed_at).not.toBeNull();
      }

      // (c) Recipient rows for other activities (the ReportResolved
      //     activity itself) are unaffected — they remain open in the
      //     reviewer's inbox.
      const stillOpenResolved = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: resolved!.id, dismissed_at: { [Op.is]: null } },
      });
      expect(stillOpenResolved.map(r => r.account_id)).toEqual([reviewerId]);

      // (d) Inbox query — the Flag recipient rows must no longer appear
      //     in a live "non-dismissed for this admin" query. This proves
      //     the dismissal removes the row from the inbox view, not just
      //     stamps a timestamp on a still-queryable row.
      for (const adminId of [adminA, adminB, adminC]) {
        const liveInbox = await NotificationRecipientEntity.findAll({
          where: { account_id: adminId, dismissed_at: { [Op.is]: null } },
        });
        const liveInboxActivityIds = liveInbox.map(r => r.notification_activity_id);
        expect(liveInboxActivityIds).not.toContain(priorFlag.id);
      }
    });

    it('dismisses prior ReportEscalated recipient rows in addition to Flag rows', async () => {
      // The handler's dismissForObject call uses verbs:['Flag','ReportEscalated'];
      // verify both verb rows are closed.
      const [adminA] = await seedAccounts(1, 'res-esc-admin');
      const [reviewerId] = await seedAccounts(1, 'res-esc-reviewer');
      const reportId = uuidv4();

      const escalated = await NotificationActivityEntity.create({
        verb: 'ReportEscalated',
        origin: 'local',
        actor_kind: 'system',
        actor_account_id: null,
        actor_uri: null,
        actor_display_name: 'System',
        actor_display_url: null,
        object_type: 'report',
        object_id: reportId,
        object_label: 'Reported event',
      });
      await NotificationRecipientEntity.create({
        notification_activity_id: escalated.id,
        account_id: adminA,
      });

      await emit('moderation:report:resolved', {
        reportId,
        eventId: uuidv4(),
        calendarId: uuidv4(),
        reviewerId,
      });

      const escalatedRecipient = await NotificationRecipientEntity.findOne({
        where: { notification_activity_id: escalated.id, account_id: adminA },
      });
      expect(escalatedRecipient!.dismissed_at).not.toBeNull();
    });

    it('leaves recipient rows for unrelated activities (different report) untouched', async () => {
      const [adminA] = await seedAccounts(1, 'res-iso-admin');
      const [reviewerId] = await seedAccounts(1, 'res-iso-reviewer');
      const reportIdToResolve = uuidv4();
      const reportIdOther = uuidv4();

      const otherFlag = await NotificationActivityEntity.create({
        verb: 'Flag',
        origin: 'local',
        actor_kind: 'anonymous',
        actor_account_id: null,
        actor_uri: null,
        actor_display_name: 'Anonymous reporter',
        actor_display_url: null,
        object_type: 'report',
        object_id: reportIdOther,
        object_label: 'Other event',
      });
      const otherRecipient = await NotificationRecipientEntity.create({
        notification_activity_id: otherFlag.id,
        account_id: adminA,
      });

      await emit('moderation:report:resolved', {
        reportId: reportIdToResolve,
        eventId: uuidv4(),
        calendarId: uuidv4(),
        reviewerId,
      });

      // Recipient row for the unrelated report stays open.
      const after = await NotificationRecipientEntity.findByPk(otherRecipient.id);
      expect(after!.dismissed_at).toBeNull();
    });

    it('is idempotent — second emit does not overwrite the first run timestamps', async () => {
      const [adminA] = await seedAccounts(1, 'res-idem-admin');
      const [reviewerId] = await seedAccounts(1, 'res-idem-reviewer');
      const reportId = uuidv4();

      const flag = await NotificationActivityEntity.create({
        verb: 'Flag',
        origin: 'local',
        actor_kind: 'anonymous',
        actor_account_id: null,
        actor_uri: null,
        actor_display_name: 'Anonymous reporter',
        actor_display_url: null,
        object_type: 'report',
        object_id: reportId,
        object_label: 'Reported event',
      });
      await NotificationRecipientEntity.create({
        notification_activity_id: flag.id,
        account_id: adminA,
      });

      await emit('moderation:report:resolved', {
        reportId,
        eventId: uuidv4(),
        calendarId: uuidv4(),
        reviewerId,
      });

      const afterFirst = await NotificationRecipientEntity.findOne({
        where: { notification_activity_id: flag.id, account_id: adminA },
      });
      const firstDismissedAt = afterFirst!.dismissed_at;
      expect(firstDismissedAt).not.toBeNull();

      // Wait so a non-idempotent UPDATE would yield a different timestamp.
      await new Promise(resolve => setTimeout(resolve, 50));

      await emit('moderation:report:resolved', {
        reportId,
        eventId: uuidv4(),
        calendarId: uuidv4(),
        reviewerId,
      });

      const afterSecond = await NotificationRecipientEntity.findOne({
        where: { notification_activity_id: flag.id, account_id: adminA },
      });
      // Timestamp from the first run is preserved.
      expect(afterSecond!.dismissed_at?.getTime()).toBe(firstDismissedAt?.getTime());
    });
  });

  // ---------------------------------------------------------------------------
  // EditorInvited / EditorRevoked — explicit single-recipient audience
  // ---------------------------------------------------------------------------

  describe('calendar:editor:invited', () => {
    it('records an EditorInvited activity addressed to the invitee account', async () => {
      const [granter, invitee] = await seedAccounts(2, 'inv');
      const calendarId = uuidv4();

      await emit('calendar:editor:invited', {
        calendarId,
        accountId: invitee,
        grantedBy: granter,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'EditorInvited', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.object_type).toBe('calendar');
      expect(activity!.actor_kind).toBe('account');
      expect(activity!.actor_account_id).toBe(granter);

      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity!.id },
      });
      expect(recipients.map(r => r.account_id)).toEqual([invitee]);
    });

    it('snapshots the granting account display name into actor_display_name (pv-02kb.1)', async () => {
      // Regression coverage for pv-02kb.1: the handler must resolve the
      // granting account via the injected AccountsInterface and pass its
      // display_name as `actorDisplayName` to recordActivity. Without
      // this, the persisted row carries an empty actor name and the inbox
      // renders a grammatically broken row (" invited you to edit ...").
      const [granter, invitee] = await seedAccounts(2, 'inv-name');
      const calendarId = uuidv4();
      getAccountByIdStub.withArgs(granter).resolves(makeAccount(granter, 'Test Q. User'));

      await emit('calendar:editor:invited', {
        calendarId,
        accountId: invitee,
        grantedBy: granter,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'EditorInvited', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.actor_display_name).toBe('Test Q. User');
      // The handler must have looked up the granter — not the invitee or
      // some other identifier.
      expect(getAccountByIdStub.calledWith(granter)).toBe(true);
    });

    it('falls back to empty actor_display_name when the granting account lookup returns undefined', async () => {
      // Deleted/missing account: the snapshot stays non-fatal. The empty
      // string keeps the column non-null (matches the existing
      // scrubReservedI18nPrefix fallback) and the client hides the actor
      // span when displayName is empty.
      const [granter, invitee] = await seedAccounts(2, 'inv-missing');
      const calendarId = uuidv4();
      getAccountByIdStub.withArgs(granter).resolves(undefined);

      await emit('calendar:editor:invited', {
        calendarId,
        accountId: invitee,
        grantedBy: granter,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'EditorInvited', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.actor_display_name).toBe('');
    });

    it('does not throw when the account interface rejects; falls back to empty actor_display_name', async () => {
      const [granter, invitee] = await seedAccounts(2, 'inv-throw');
      const calendarId = uuidv4();
      getAccountByIdStub.withArgs(granter).rejects(new Error('boom'));

      await emit('calendar:editor:invited', {
        calendarId,
        accountId: invitee,
        grantedBy: granter,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'EditorInvited', object_id: calendarId },
      });
      // Activity is still recorded even when actor identity resolution
      // fails. The fallback keeps notifications a true side-effect domain.
      expect(activity).not.toBeNull();
      expect(activity!.actor_display_name).toBe('');
    });
  });

  describe('calendar:editor:revoked', () => {
    it('records an EditorRevoked activity addressed to the revoked editor account', async () => {
      const [revoker, revoked] = await seedAccounts(2, 'rev');
      const calendarId = uuidv4();

      await emit('calendar:editor:revoked', {
        calendarId,
        accountId: revoked,
        revokedBy: revoker,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'EditorRevoked', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.object_type).toBe('calendar');
      expect(activity!.actor_kind).toBe('account');
      expect(activity!.actor_account_id).toBe(revoker);

      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity!.id },
      });
      expect(recipients.map(r => r.account_id)).toEqual([revoked]);
    });

    it('snapshots the revoking account display name into actor_display_name (pv-02kb.1)', async () => {
      const [revoker, revoked] = await seedAccounts(2, 'rev-name');
      const calendarId = uuidv4();
      getAccountByIdStub.withArgs(revoker).resolves(makeAccount(revoker, 'Test Q. User'));

      await emit('calendar:editor:revoked', {
        calendarId,
        accountId: revoked,
        revokedBy: revoker,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'EditorRevoked', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.actor_display_name).toBe('Test Q. User');
      expect(getAccountByIdStub.calledWith(revoker)).toBe(true);
    });

    it('falls back to empty actor_display_name when the revoking account lookup returns undefined', async () => {
      const [revoker, revoked] = await seedAccounts(2, 'rev-missing');
      const calendarId = uuidv4();
      getAccountByIdStub.withArgs(revoker).resolves(undefined);

      await emit('calendar:editor:revoked', {
        calendarId,
        accountId: revoked,
        revokedBy: revoker,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'EditorRevoked', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.actor_display_name).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // Snapshot object_label population (pv-vdu2.2)
  //
  // Each handler populates `object_label` at write time from a cross-domain
  // lookup. The deleted-object render fallback depends on a non-empty
  // snapshot — once the underlying calendar / event / report is gone, this
  // is the only display string the API can return.
  //
  // For each handler we assert (a) a populated lookup produces the
  // resolved display name on the persisted activity row, and (b) a failed /
  // empty lookup falls back to the generic verb-specific label so the
  // snapshot is never empty.
  // ---------------------------------------------------------------------------

  describe('snapshot object_label population', () => {
    it('Follow handler snapshots calendar.name into object_label', async () => {
      const calendarId = uuidv4();
      getCalendarStub.withArgs(calendarId).resolves(makeCalendar(calendarId, 'en', 'Music Festival Calendar'));

      await emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Alice',
        followerUrl: 'https://remote.example/users/alice',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.object_label).toBe('Music Festival Calendar');
    });

    it('Follow handler falls back to "Calendar" when the lookup returns null', async () => {
      // Defaults already resolve getCalendarStub to null, so no override
      // needed. The fallback keeps the snapshot non-empty for the
      // deleted-object render path.
      const calendarId = uuidv4();
      await emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Alice',
        followerUrl: 'https://remote.example/users/alice',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activity!.object_label).toBe('Calendar');
      expect(activity!.object_label.length).toBeGreaterThan(0);
    });

    it('Follow handler falls back when the calendar interface throws', async () => {
      const calendarId = uuidv4();
      getCalendarStub.withArgs(calendarId).rejects(new Error('boom'));

      await emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Alice',
        followerUrl: 'https://remote.example/users/alice',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activity!.object_label).toBe('Calendar');
    });

    it('Announce handler snapshots event title into object_label', async () => {
      const eventId = uuidv4();
      const calendarId = uuidv4();
      getEventByIdStub.withArgs(eventId).resolves(makeEvent(eventId, 'en', 'Annual Conference 2026'));

      await emit('activitypub:event:reposted', {
        eventId,
        calendarId,
        reposterName: 'Bob',
        reposterUrl: 'https://remote.example/users/bob',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Announce', object_id: eventId },
      });
      expect(activity!.object_label).toBe('Annual Conference 2026');
    });

    it('Announce handler falls back to "Event" when the event has no populated title', async () => {
      // Default stub returns an empty CalendarEvent (no content);
      // displayName('Event') returns the fallback directly.
      const eventId = uuidv4();
      await emit('activitypub:event:reposted', {
        eventId,
        calendarId: uuidv4(),
        reposterName: 'Bob',
        reposterUrl: 'https://remote.example/users/bob',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Announce', object_id: eventId },
      });
      expect(activity!.object_label).toBe('Event');
    });

    it('Flag handler snapshots the flagged event title into object_label', async () => {
      // Flag/ReportEscalated/ReportResolved
      // labels prefer the event title (most useful for the recipient).
      // The calendar lookup only fires as a fallback when the event lookup
      // fails or yields an empty title.
      const [adminA] = await seedAccounts(1, 'flag-label');
      getInstanceAdminsStub.resolves([adminA]);

      const calendarId = uuidv4();
      const eventId = uuidv4();
      const reportId = uuidv4();
      getEventByIdStub.withArgs(eventId).resolves(makeEvent(eventId, 'en', 'Open Mic Night'));
      // The calendar would resolve too, but the event lookup wins.
      getCalendarStub.withArgs(calendarId).resolves(makeCalendar(calendarId, 'en', 'Community Hub'));

      await emit('moderation:report:flagged', {
        reportId,
        eventId,
        calendarId,
        origin: 'local',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Flag', object_id: reportId },
      });
      expect(activity!.object_label).toBe('Open Mic Night');
      // Calendar fallback must not have been consulted when the event
      // title was available.
      expect(getCalendarStub.called).toBe(false);
    });

    it('Flag handler falls back to the owning calendar name when the event lookup fails', async () => {
      // The event-first path covers the common case. When the event lookup
      // throws (deleted/remote event, transient outage) the handler falls
      // back to the calendar name so the snapshot stays meaningful.
      const [adminA] = await seedAccounts(1, 'flag-label-cal');
      getInstanceAdminsStub.resolves([adminA]);

      const calendarId = uuidv4();
      const eventId = uuidv4();
      const reportId = uuidv4();
      getEventByIdStub.withArgs(eventId).rejects(new Error('not found'));
      getCalendarStub.withArgs(calendarId).resolves(makeCalendar(calendarId, 'en', 'Community Hub'));

      await emit('moderation:report:flagged', {
        reportId,
        eventId,
        calendarId,
        origin: 'local',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Flag', object_id: reportId },
      });
      expect(activity!.object_label).toBe('Community Hub');
    });

    it('Flag handler falls back to "Report" when both event and calendar lookups fail (admin report against remote event)', async () => {
      const [adminA] = await seedAccounts(1, 'flag-label-null');
      getInstanceAdminsStub.resolves([adminA]);

      const eventId = uuidv4();
      const reportId = uuidv4();
      // Default getEventByIdStub returns an empty CalendarEvent (no
      // populated title) and calendarId is null — exercise the
      // both-failed branch.
      await emit('moderation:report:flagged', {
        reportId,
        eventId,
        calendarId: null,
        origin: 'local',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Flag', object_id: reportId },
      });
      expect(activity!.object_label).toBe('Report');
      // Calendar lookup must not be triggered when calendarId is null.
      expect(getCalendarStub.called).toBe(false);
    });

    it('ReportEscalated handler snapshots the flagged event title', async () => {
      const [adminA] = await seedAccounts(1, 'esc-label');
      getInstanceAdminsStub.resolves([adminA]);

      const calendarId = uuidv4();
      const eventId = uuidv4();
      const reportId = uuidv4();
      getEventByIdStub.withArgs(eventId).resolves(makeEvent(eventId, 'en', 'Poetry Reading'));
      getCalendarStub.withArgs(calendarId).resolves(makeCalendar(calendarId, 'en', 'Local Theater'));

      await emit('moderation:report:escalated', {
        reportId,
        eventId,
        calendarId,
        reason: 'Auto-escalated due to inaction',
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'ReportEscalated', object_id: reportId },
      });
      expect(activity!.object_label).toBe('Poetry Reading');
    });

    it('ReportResolved handler snapshots the flagged event title', async () => {
      const [reviewerId] = await seedAccounts(1, 'res-label-reviewer');

      const calendarId = uuidv4();
      const eventId = uuidv4();
      const reportId = uuidv4();
      getEventByIdStub.withArgs(eventId).resolves(makeEvent(eventId, 'en', 'Book Signing'));
      getCalendarStub.withArgs(calendarId).resolves(makeCalendar(calendarId, 'en', 'Bookstore Events'));

      await emit('moderation:report:resolved', {
        reportId,
        eventId,
        calendarId,
        reviewerId,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'ReportResolved', object_id: reportId },
      });
      expect(activity!.object_label).toBe('Book Signing');
    });

    it('EditorInvited handler snapshots calendar.name into object_label', async () => {
      const [granter, invitee] = await seedAccounts(2, 'inv-label');
      const calendarId = uuidv4();
      getCalendarStub.withArgs(calendarId).resolves(makeCalendar(calendarId, 'en', 'Garden Club'));

      await emit('calendar:editor:invited', {
        calendarId,
        accountId: invitee,
        grantedBy: granter,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'EditorInvited', object_id: calendarId },
      });
      expect(activity!.object_label).toBe('Garden Club');
    });

    it('EditorRevoked handler snapshots calendar.name into object_label', async () => {
      const [revoker, revoked] = await seedAccounts(2, 'rev-label');
      const calendarId = uuidv4();
      getCalendarStub.withArgs(calendarId).resolves(makeCalendar(calendarId, 'en', 'Book Club'));

      await emit('calendar:editor:revoked', {
        calendarId,
        accountId: revoked,
        revokedBy: revoker,
      });

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'EditorRevoked', object_id: calendarId },
      });
      expect(activity!.object_label).toBe('Book Club');
    });

    // -------------------------------------------------------------------------
    // Deleted-object rendering — snapshot survives object deletion
    //
    // Deleted-object rendering and bead pv-vdu2.2
    // acceptance criterion. Once the handler has written the snapshot
    // label, a subsequent delete of the underlying object must NOT clear
    // the label — the persisted row is the source of truth for what the
    // API returns through the deleted-object render fallback.
    // -------------------------------------------------------------------------

    it('persists a non-empty object_label that survives deletion of the underlying calendar', async () => {
      const calendarId = uuidv4();
      // Snapshot at emit time: the calendar exists and has a name.
      getCalendarStub.withArgs(calendarId).resolves(makeCalendar(calendarId, 'en', 'Soon-deleted Calendar'));

      await emit('activitypub:calendar:followed', {
        calendarId,
        followerName: 'Alice',
        followerUrl: 'https://remote.example/users/alice',
      });

      // Now simulate the underlying calendar being deleted — subsequent
      // lookups return null. The previously-written snapshot must NOT be
      // affected; the label on the persisted activity row is the contract.
      getCalendarStub.withArgs(calendarId).resolves(null);

      const activity = await NotificationActivityEntity.findOne({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activity).not.toBeNull();
      expect(activity!.object_label).toBe('Soon-deleted Calendar');
      expect(activity!.object_label).not.toBe('');
    });
  });
});
