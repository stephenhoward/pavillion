/**
 * Federation integration tests for inbound Flag activity (pv-89mw.9.1).
 *
 * These tests assert two end-to-end invariants of the inbound-Flag pipeline
 * that the existing mock-based `flag-inbox.test.ts` cannot prove because it
 * stubs the moderation interface:
 *
 *   1. Anonymization on inbound Flag — an inbound Flag from a remote
 *      instance produces real `notification_activity` + `notification_recipient`
 *      rows with anonymization applied
 *      `actor_kind='anonymous'`, `actor_display_url='https://<host>'`,
 *      `actor_account_id IS NULL`, `actor_uri IS NULL`. The reporting
 *      instance's hostname IS retained on the row (instance attribution),
 *      but the per-actor identifier is not.
 *
 *   2. No outbound side effect — after the inbound Flag is recorded, NO
 *      `Create(Flag)` activity is emitted to the local instance's AP outbox.
 *      Notifications must not have side-effected outbound federation.
 *      (Outbound flag forwarding is a separate, deliberate action exercised
 *      by `flag-outbox.test.ts`; that suite must continue to pass.)
 *
 * Test tier: integration.)'
 * assertion can be made at integration tier by inspecting the AP outbox queue
 * /state after the inbound Flag fires." Escalation to a Docker-based two-
 * instance e2e is reserved for the case where integration cannot observe
 * outbound emissions cleanly — here `ActivityPubOutboxMessageEntity.findAll`
 * is sufficient.
 *
 * Wiring note: this suite does NOT use TestEnvironment's internal event bus.
 * It uses TestEnvironment only for DB sync and entity registration, then
 * builds the AP-inbox → moderation → notifications chain on its own
 * EventEmitter so the chain is observable in isolation. This matches the
 * pattern used by `notifications/test/integration/role-resolver.test.ts`.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import AccountService from '@/server/accounts/service/account';
import AccountsInterface from '@/server/accounts/interface';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { AccountRoleEntity } from '@/server/common/entity/account';
import { EventEntity, EventContentEntity } from '@/server/calendar/entity/event';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { waitFor } from '@/server/common/test/helpers/emit-and-settle';

import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import ModerationInterface from '@/server/moderation/interface';
import { ReportEntity } from '@/server/moderation/entity/report';

import NotificationService from '@/server/notifications/service/notification';
import NotificationEventHandlers from '@/server/notifications/events';
import {
  NotificationActivityEntity,
  NotificationRecipientEntity,
} from '@/server/notifications/entity/notification_activity';

/**
 * Integration suite for the AP-inbox → moderation → notifications chain
 * triggered by an inbound Flag activity. The suite asserts at the DB layer:
 * notification rows reflect anonymization; AP outbox stays empty.
 */
describe('Federation Flag inbox — anonymization + no outbound side effect (integration)', () => {
  let env: TestEnvironment;
  let eventBus: EventEmitter;
  let calendarInterface: CalendarInterface;
  let accountsInterface: AccountsInterface;
  let moderationInterface: ModerationInterface;
  let inboxService: ProcessInboxService;

  let ownerAccount: Account;
  let adminAccount: Account;
  let calendar: Calendar;
  let event: EventEntity;

  const REMOTE_HOST = 'remote.federation.test';
  const REMOTE_ACTOR_URI = `https://${REMOTE_HOST}/calendars/reporter-calendar`;

  beforeAll(async () => {
    // TestEnvironment.init() runs db.sync({force:true}) and registers all
    // entities. We construct our own chain on top so the bus is observable.
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface(configurationInterface);
    accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    calendarInterface = new CalendarInterface(eventBus, accountsInterface);

    // ModerationInterface needs an ActivityPubInterface for forwardReport
    // (outbound flag forwarding). The inbound path under test never reaches
    // forwardReport — receiveRemoteReport persists the report and emits the
    // bus event, end of story. A minimal stub satisfies the constructor
    // type without touching the outbox.
    const activityPubInterfaceStub = {
      // Cast-friendly placeholders. None are invoked by receiveRemoteReport.
      isInstanceBlocked: async () => false,
    } as any;
    const emailInterfaceStub = { send: async () => {} } as any;

    moderationInterface = new ModerationInterface(
      eventBus,
      calendarInterface,
      accountsInterface,
      emailInterfaceStub,
      configurationInterface,
      activityPubInterfaceStub,
    );

    inboxService = new ProcessInboxService(eventBus, calendarInterface, moderationInterface);

    // Notifications: wire the real service + handlers on the same bus so
    // moderation:report:flagged is observed end-to-end. The service writes
    // to the same DB the assertions read from.
    const notificationService = new NotificationService({ calendarInterface, accountsInterface });
    new NotificationEventHandlers(notificationService, calendarInterface, accountsInterface).install(eventBus);

    // Seed the calendar owner. `_setupAccount` is the same helper the
    // role-resolver integration test uses; it inserts an AccountEntity and
    // the supporting rows.
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);
    const ownerInfo = await accountService._setupAccount('flag-fed-owner@pavillion.dev', 'testpassword');
    ownerAccount = ownerInfo.account;

    // `_setupAccount` auto-grants the FIRST account the admin role to keep
    // setup-mode middleware happy across the test suite. Strip that so the
    // assertions about who receives the notification are deterministic:
    // the owner's recipient row comes from `calendar-owners` resolution,
    // not from happening to also be the only admin.
    await AccountRoleEntity.destroy({ where: { role: 'admin' } });

    // Seed a dedicated admin account so the test exercises the owners+admins
    // fanout).
    const adminInfo = await accountService._setupAccount('flag-fed-admin@pavillion.dev', 'testpassword');
    adminAccount = adminInfo.account;
    await AccountRoleEntity.create({ account_id: adminAccount.id, role: 'admin' });

    // Calendar owned by `ownerAccount` — createCalendar inserts the owner
    // CalendarMember row, which is what getOwnersForCalendar reads.
    calendar = await calendarInterface.createCalendar(ownerAccount, 'flagfedcalendar');

    // Seed the flagged event directly. `processFlagActivity` only needs
    // `getEventById(eventId)` to return a row with a calendarId; bypassing
    // the full createEvent service avoids dragging in event-content
    // validation and originator-context plumbing irrelevant to this test.
    const eventId = uuidv4();
    event = await EventEntity.create({
      id: eventId,
      calendar_id: calendar.id,
      url_name: 'flagged-event',
      recurring: false,
      rrule: null,
      external_link: null,
    });
    await EventContentEntity.create({
      id: uuidv4(),
      event_id: eventId,
      language: 'en',
      name: 'Flagged Event',
      description: 'An event that will be reported by a remote instance.',
    });
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  beforeEach(async () => {
    // Clear notification rows so each test starts from a known state. We
    // truncate the recipient table first (it FKs to activity). Other tables
    // (accounts, calendars, events) are seeded once in beforeAll and reused.
    await NotificationRecipientEntity.destroy({ where: {}, truncate: true });
    await NotificationActivityEntity.destroy({ where: {}, truncate: true });
    // Truncate ReportEntity between tests. Notifications are kept agnostic
    // of report rows by snapshotting `object_label` at insert time, but the
    // moderation domain's `receiveRemoteReport` persists a new ReportEntity
    // per inbound Flag. Two tests in the same
    // suite hitting the same `(event, reporter)` pair would otherwise
    // collide on shared id/state.
    await ReportEntity.destroy({ where: {}, truncate: true });
    // Clear the AP outbox so the "no outbound side effect" assertion is
    // not contaminated by prior test state. Other AP entities are not
    // touched.
    await ActivityPubOutboxMessageEntity.destroy({ where: {}, truncate: true });
  });

  afterEach(() => {
    // No sinon sandbox in use — beforeAll seeds shared fixtures and
    // beforeEach truncates the per-test tables. Nothing to restore.
  });

  // The bus emit fires inside `receiveRemoteReport`, deep inside
  // `processFlagActivity`, so the handler's promise can't be awaited
  // directly. Each `processFlagActivity` call is followed by `waitFor`
  // polling the actual DB row the assertions read, rather than a fixed-
  // budget microtask/macrotask drain. Fixed drains race the chain length;
  // condition polling races the invariant and stays fast in the happy path
  // while surviving slow CI runners (x86 had observed flakes where the
  // notification row appeared just after a 25ms fixed drain returned).

  it('inbound Flag from a remote instance records anonymized notification rows for owners + admins', async () => {
    const flagActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Flag',
      id: `https://${REMOTE_HOST}/flags/${uuidv4()}`,
      actor: REMOTE_ACTOR_URI,
      object: `https://local.instance/events/${event.id}`,
      content: 'This event contains spam',
      tag: [{ type: 'Hashtag', name: '#spam' }],
      summary: 'Event report: spam',
      published: '2026-05-22T12:00:00Z',
    };

    await inboxService.processFlagActivity(calendar, flagActivity);

    // Exactly one Flag activity row should exist for this event's report.
    const activities = await waitFor(async () => {
      const rows = await NotificationActivityEntity.findAll({ where: { verb: 'Flag' } });
      return rows.length === 1 ? rows : null;
    });
    expect(activities, 'one Flag activity row inserted').toHaveLength(1);

    const activity = activities[0];

    // Anonymization invariants —, federated
    // case. The hostname IS retained on actor_display_url (instance
    // attribution), but per-actor identity fields are nulled out.
    expect(activity.actor_kind, 'actor_kind anonymous').toBe('anonymous');
    expect(activity.actor_account_id, 'actor_account_id NULL').toBeNull();
    expect(activity.actor_uri, 'actor_uri NULL — identity not stored').toBeNull();
    expect(activity.actor_display_url, 'actor_display_url is the instance root').toBe(
      `https://${REMOTE_HOST}`,
    );

    // Object reference points at the created Report, not at the event.
    // The click-through target is the
    // first-class record produced by the verb.
    expect(activity.object_type, 'object_type is report').toBe('report');
    expect(activity.origin, 'origin is federated').toBe('federated');

    // Recipient rows: owner + admin both fanned out. Per the handler in
    // pv-89mw.5.1, calendar owners and instance admins are merged into a
    // single explicit-audience list before recordActivity is called.
    const recipients = await NotificationRecipientEntity.findAll({
      where: { notification_activity_id: activity.id },
    });
    const recipientAccountIds = recipients.map(r => r.account_id).sort();
    expect(recipientAccountIds, 'owner + admin recipient rows present').toEqual(
      [ownerAccount.id, adminAccount.id].sort(),
    );
  });

  it('does NOT emit a Create(Flag) (or Flag) activity to the local AP outbox after recording the inbound notification', async () => {
    const flagActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Flag',
      id: `https://${REMOTE_HOST}/flags/${uuidv4()}`,
      actor: REMOTE_ACTOR_URI,
      object: `https://local.instance/events/${event.id}`,
      content: 'Misleading information',
      tag: [{ type: 'Hashtag', name: '#misleading' }],
      summary: 'Event report: misleading',
      published: '2026-05-22T12:05:00Z',
    };

    await inboxService.processFlagActivity(calendar, flagActivity);

    // The notification row should have been written — proves the chain
    // executed end-to-end and the negative outbox check is not meaningless.
    const activities = await waitFor(async () => {
      const rows = await NotificationActivityEntity.findAll({ where: { verb: 'Flag' } });
      return rows.length === 1 ? rows : null;
    });
    expect(activities, 'notification row was written').toHaveLength(1);

    // Critical invariant: notifications domain must NOT side-effect outbound
    // federation. The outbox table must be empty for both `Flag` (an inbound
    // Flag should never re-emit) AND `Create` (defense-in-depth: AP servers
    // sometimes wrap report-like activities in Create). Neither shape is
    // valid here.
    const outboxAll = await ActivityPubOutboxMessageEntity.findAll();
    expect(outboxAll, 'AP outbox is empty after inbound Flag').toHaveLength(0);

    // Explicit named-type check, for diagnostic clarity if the suite ever
    // grows to include other ambient outbox activity.
    const flagOutbox = await ActivityPubOutboxMessageEntity.findAll({ where: { type: 'Flag' } });
    expect(flagOutbox, 'no Flag-typed outbox message produced').toHaveLength(0);
    const createOutbox = await ActivityPubOutboxMessageEntity.findAll({ where: { type: 'Create' } });
    expect(createOutbox, 'no Create-typed outbox message produced').toHaveLength(0);
  });
});
