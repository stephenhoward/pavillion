/**
 * End-to-end integration test for the inbound Flag HTTP path.
 *
 * `ProcessInboxService.dispatchByType` has handled `Flag` since federated
 * moderation reporting was built, but the inbox route rejected every Flag with
 * 400 "Unsupported activity type" before it could be stored or dispatched, so
 * the handler was reachable only via same-instance local dispatch. The
 * mock-based suites could not catch that: they call `processFlagActivity`
 * directly and never cross the HTTP boundary.
 *
 * This suite drives the whole chain over a real request:
 *   POST /calendars/:urlname/inbox  →  ap_inbox row (auth_source recorded)
 *   →  inboxMessageAdded  →  dispatchByType  →  processFlagActivity
 *   →  receiveRemoteReport  →  a reporterType='federation' Report on the
 *      reported event's owning calendar, carrying the round-tripped category.
 *
 * Scaffolding follows `inbox-auth.integration.test.ts`: TestEnvironment boots
 * the real server (so the real AP↔moderation wiring is under test), supertest
 * POSTs the activity, and `SKIP_SIGNATURES=true` bypasses signature
 * verification so the test does not have to manage remote keys.
 *
 * Each test reports a distinct seeded event and scopes its assertions by
 * `event_id` rather than truncating tables between tests: dispatch is async,
 * so a truncate in `beforeEach` would race the previous test's in-flight
 * transaction on the shared in-memory SQLite connection.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';
import crypto from 'crypto';
import config from 'config';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { waitFor } from '@/server/common/test/helpers/emit-and-settle';
import { EventEntity, EventContentEntity } from '@/server/calendar/entity/event';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { NotificationActivityEntity } from '@/server/notifications/entity/notification_activity';
import { ReportEntity } from '@/server/moderation/entity/report';
import { BlockedInstanceEntity } from '@/server/moderation/entity/blocked_instance';
import { ReportCategory } from '@/common/model/report';

const REPORTING_HOST = 'reporter.example.com';
const REPORTING_ACTOR_URI = `https://${REPORTING_HOST}/calendars/reporter`;
const BLOCKED_HOST = 'defederated.example.com';
const BLOCKED_ACTOR_URI = `https://${BLOCKED_HOST}/calendars/reporter`;

describe('Inbound Flag over HTTP (integration)', () => {
  let env: TestEnvironment;
  let testCalendar: Calendar;
  /** A second calendar that owns none of the flagged events. */
  let bystanderCalendar: Calendar;
  let ownerAccount: Account;

  /**
   * Seeds an event owned by the test calendar. `processFlagActivity` only
   * needs `getEventById` to return a row with a `calendarId`; bypassing the
   * event service keeps content validation out of a test about the inbox
   * boundary.
   */
  const seedEvent = async (urlName: string): Promise<string> => {
    const eventId = uuidv4();
    await EventEntity.create({
      id: eventId,
      calendar_id: testCalendar.id,
      url_name: urlName,
      recurring: false,
      rrule: null,
      external_link: null,
    });
    await EventContentEntity.create({
      id: uuidv4(),
      event_id: eventId,
      language: 'en',
      name: 'Flagged Event',
      description: 'An event reported by a remote instance.',
    });
    return eventId;
  };

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    const calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const ownerInfo = await accountService._setupAccount('flag-http-owner@pavillion.dev', 'testpassword');
    ownerAccount = ownerInfo.account;

    testCalendar = await calendarInterface.createCalendar(ownerAccount, 'flaghttpcalendar');
    bystanderCalendar = await calendarInterface.createCalendar(ownerAccount, 'flaghttpbystander');

    // Defederate one host up front so the blocked-instance case needs no
    // mid-suite mutation (and therefore no ordering dependency).
    await BlockedInstanceEntity.create({
      id: uuidv4(),
      domain: BLOCKED_HOST,
      reason: 'Test defederation',
      blocked_at: new Date(),
      blocked_by: ownerAccount.id,
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  let originalSkipSignatures: string | undefined;

  beforeEach(() => {
    originalSkipSignatures = process.env.SKIP_SIGNATURES;
    process.env.SKIP_SIGNATURES = 'true';
  });

  afterEach(async () => {
    if (originalSkipSignatures === undefined) {
      delete process.env.SKIP_SIGNATURES;
    }
    else {
      process.env.SKIP_SIGNATURES = originalSkipSignatures;
    }
  });

  /**
   * Blocks until the inbox row for `activityId` has been dispatched.
   * `processInboxMessage` stamps `processed_status` last, so its presence is
   * the completion signal for the whole synchronous dispatch chain.
   */
  const awaitDispatched = async (activityId: string): Promise<ActivityPubInboxMessageEntity> =>
    waitFor(async () => {
      const found = await ActivityPubInboxMessageEntity.findByPk(activityId);
      return found?.processed_status ? found : null;
    });

  /**
   * Blocks until the notification tail of the dispatch chain has landed for
   * a report filed through the pipeline. The `processed_status` stamp lands
   * before the notifications handler (the only REPORT_FLAGGED subscriber)
   * finishes its own async writes, so any test that files a report must wait
   * for the handler's terminal write — the Flag activity row — before
   * finishing. Otherwise the tail's transaction can overlap the next test's
   * request on the shared in-memory SQLite connection and corrupt both
   * (previously mitigated with a fixed-budget drain; see pv-ss0s).
   */
  const awaitNotificationTail = async (reportId: string): Promise<void> => {
    await waitFor(() =>
      NotificationActivityEntity.findOne({ where: { verb: 'Flag', object_id: reportId } }),
    );
  };

  const buildFlag = (eventId: string, overrides: Record<string, unknown> = {}) => ({
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Flag',
    id: `https://${REPORTING_HOST}/flags/${uuidv4()}`,
    actor: REPORTING_ACTOR_URI,
    object: `https://${REPORTING_HOST}/events/${eventId}`,
    content: 'This event is spam.',
    summary: 'Event report: spam',
    tag: [{ type: 'Hashtag', name: '#spam' }],
    published: '2026-05-22T12:00:00Z',
    ...overrides,
  });

  const postFlag = async (activity: Record<string, unknown>, inboxCalendarUrlName?: string) => {
    const signature =
      `keyId="${activity.actor}#main-key",algorithm="rsa-sha256",` +
      'headers="(request-target) host date content-type digest",signature="fakeSignature"';

    return request(env.app)
      .post(`/calendars/${inboxCalendarUrlName ?? testCalendar.urlName}/inbox`)
      .set('Content-Type', 'application/activity+json')
      .set('Date', new Date().toUTCString())
      .set('Host', 'localhost')
      .set('Signature', signature)
      .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(activity)).digest('base64')}`)
      .send(activity);
  };

  it('accepts a signed Flag, records it in ap_inbox, and creates a federation report on the owning calendar', async () => {
    const eventId = await seedEvent('flagged-accepted');
    const activity = buildFlag(eventId);

    const response = await postFlag(activity);
    expect(response.status).toBe(200);

    // DEC-013: every ap_inbox row is authenticated by a recorded mechanism.
    const row = await awaitDispatched(activity.id);
    expect(row, 'Flag persisted as an ap_inbox row').not.toBeNull();
    expect(row.type).toBe('Flag');
    expect(row.auth_source).toBe('http_signature');
    expect(row.auth_origin).toBe(`https://${REPORTING_HOST}`);
    expect(row.processed_status).toBe('ok');

    const reports = await ReportEntity.findAll({ where: { event_id: eventId } });
    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report.reporter_type).toBe('federation');
    expect(report.calendar_id, 'report lands on the reported event\'s owning calendar').toBe(testCalendar.id);
    expect(report.category, 'category round-trips from the Hashtag').toBe(ReportCategory.SPAM);
    expect(report.description).toBe('This event is spam.');
    // Only the reporting instance's host is retained — never the reporter.
    expect(report.forwarded_from_instance).toBe(REPORTING_HOST);
    expect(report.forwarded_report_id).toBe(activity.id);

    await awaitNotificationTail(report.id);
  });

  it('defaults to the "other" category when the Flag carries no recognized Hashtag', async () => {
    const eventId = await seedEvent('flagged-unknown-tag');
    const activity = buildFlag(eventId, { tag: [{ type: 'Hashtag', name: '#not-a-category' }] });

    const response = await postFlag(activity);
    expect(response.status).toBe(200);

    await awaitDispatched(activity.id);
    const reports = await ReportEntity.findAll({ where: { event_id: eventId } });
    expect(reports).toHaveLength(1);
    expect(reports[0].category).toBe(ReportCategory.OTHER);

    await awaitNotificationTail(reports[0].id);
  });

  it('rejects a Flag whose content exceeds the local report description cap', async () => {
    const eventId = await seedEvent('flagged-oversized');
    const activity = buildFlag(eventId, { content: 'x'.repeat(2001) });

    const response = await postFlag(activity);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid Flag activity');

    const row = await ActivityPubInboxMessageEntity.findByPk(activity.id);
    expect(row, 'over-length Flag is not persisted').toBeNull();
  });

  it('stops filing reports once the reporting instance reaches its per-event cap', async () => {
    // The route limiters bound how fast one sender may talk to one inbox;
    // neither bounds how many reports pile up against a single event. The
    // moderation service enforces that cap, and the surplus Flags must still
    // settle as processed — suppression is a policy outcome, not a failure.
    const maxPerInstance = config.get<number>('rateLimit.moderation.federatedReportByInstance.max');
    const eventId = await seedEvent('flagged-flooded');

    // Backdate nothing: these stand in for reports this instance already
    // filed about this event inside the window. Seeding them directly keeps
    // the test to two requests — each POST drives a full async dispatch
    // pipeline on one shared SQLite connection, and the arithmetic of the
    // cap is covered by the moderation service unit tests. What this test
    // proves is that the counting query matches the real schema and that a
    // suppressed Flag still settles as processed.
    for (let i = 0; i < maxPerInstance - 1; i++) {
      await ReportEntity.create({
        id: uuidv4(),
        event_id: eventId,
        calendar_id: testCalendar.id,
        category: ReportCategory.SPAM,
        description: `Earlier federated report ${i}`,
        reporter_type: 'federation',
        status: 'submitted',
        forwarded_from_instance: REPORTING_HOST,
        forwarded_report_id: `https://${REPORTING_HOST}/flags/seeded-${i}`,
      });
    }

    const accepted = buildFlag(eventId, { content: 'The last report under the cap.' });
    expect((await postFlag(accepted)).status).toBe(200);
    expect((await awaitDispatched(accepted.id)).processed_status).toBe('ok');
    expect(
      await ReportEntity.count({ where: { event_id: eventId } }),
      'reports below the cap are still filed',
    ).toBe(maxPerInstance);

    // The accepted Flag's notification tail runs past the ap_inbox row's
    // processed_status stamp. Wait for its terminal write before the next
    // request opens its own transaction on the shared in-memory connection.
    const acceptedReport = await ReportEntity.findOne({
      where: { forwarded_report_id: accepted.id },
    });
    await awaitNotificationTail(acceptedReport!.id);

    const suppressed = buildFlag(eventId, { content: 'One report too many.' });
    expect((await postFlag(suppressed)).status).toBe(200);
    const suppressedRow = await awaitDispatched(suppressed.id);
    expect(suppressedRow.processed_status, 'a suppressed Flag is processed, not errored').toBe('ok');

    expect(
      await ReportEntity.count({ where: { event_id: eventId } }),
      'queue depth for one event from one instance is capped',
    ).toBe(maxPerInstance);
  });

  it('creates no report for a Flag delivered to a calendar that does not own the event', async () => {
    // A Flag belongs in the inbox of the object's host. Accepting misdirected
    // Flags would let a sender multiply throughput against one event by
    // spraying it across enumerable calendar inboxes.
    const eventId = await seedEvent('flagged-misdirected');
    const activity = buildFlag(eventId);

    const response = await postFlag(activity, bystanderCalendar.urlName);
    expect(response.status).toBe(200);

    const row = await awaitDispatched(activity.id);
    expect(row.processed_status).toBe('ok');

    const reports = await ReportEntity.findAll({ where: { event_id: eventId } });
    expect(reports, 'a misdirected Flag files nothing').toHaveLength(0);
  });

  it('creates no report for a Flag from a blocked instance', async () => {
    const eventId = await seedEvent('flagged-by-blocked');
    const activity = buildFlag(eventId, { actor: BLOCKED_ACTOR_URI });

    // The route admits the activity — instance blocking is enforced at
    // dispatch, which marks the row 'blocked' rather than acting on it.
    const response = await postFlag(activity);
    expect(response.status).toBe(200);

    const row = await awaitDispatched(activity.id);
    expect(row.processed_status).toBe('blocked');

    const reports = await ReportEntity.findAll({ where: { event_id: eventId } });
    expect(reports, 'a blocked instance cannot file a moderation report').toHaveLength(0);
  });
});
