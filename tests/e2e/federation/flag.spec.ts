/**
 * Flag Activity Federation (cross-instance moderation reports)
 *
 * Bead context: pv-o3ay.4 -- empirical proof that a moderation report filed on
 * one instance against an event hosted by another is delivered over the wire
 * and filed in the origin calendar owner's report queue.
 *
 * Why this needs to be an e2e and not another unit test:
 *
 *   The forward path resolves its recipient inbox through
 *   `ProcessOutboxService.resolveInboxUrl`'s DIRECT-URL branch — the
 *   recipient is a bare `https://<host>/calendars/<name>` actor URI rather
 *   than a WebFinger handle. That branch is what silently swallowed the
 *   original bug pv-o3ay.8 fixed: the old hardcoded `https://<host>/admin`
 *   recipient fetched an HTML page, `response.data.inbox` was `undefined`,
 *   and delivery aborted before signing with nothing surfaced to the caller.
 *   Every other test in the repository either passes a WebFinger handle
 *   (taking the other branch) or stubs `resolveInboxUrl` wholesale, so this
 *   spec is the only place the direct-URL branch runs end to end. Nothing
 *   here may be stubbed.
 *
 * Round trip under test:
 *   1. beta follows alpha's calendar; alpha creates a public event
 *   2. the event federates to beta, where it is stored as a REMOTE event
 *      (`calendarId: null`, `eventSourceUrl` pointing back at alpha)
 *   3. beta's admin files an admin report against it — remote events are
 *      reachable only through the admin path (pv-o3ay.7)
 *   4. beta forwards the report, emitting a Flag addressed to alpha's
 *      CALENDAR actor, not an instance admin actor (DEC-015)
 *   5. alpha's calendar inbox accepts the Flag (pv-o3ay.9) and files a
 *      `reporterType: 'federation'` report scoped to the owning calendar
 *
 * Two paired assertions, and the second is the load-bearing one. On the
 * calendar async path a Flag takes, `logInboxActivityAccepted` fires as soon
 * as the `ap_inbox` row is written — BEFORE dispatch — so it is emitted even
 * for a Flag that dispatch then drops as misdirected, suppresses under the
 * per-(event, instance) throttle, or refuses from a blocked instance. The log
 * poll therefore proves the activity crossed the wire and was admitted; only
 * the moderation-queue assertion proves it was acted on.
 *
 * Queue-surface note: the received report is asserted through the
 * calendar-owner queue (`GET /api/v1/calendars/:id/reports`), not the
 * instance-admin queue. `getAdminReports` bases its query on
 * "escalated OR admin-initiated", so a freshly received federated report
 * (`reporterType: 'federation'`, `status: 'submitted'`) can never match
 * `source=federation` there. The owner queue is also where DEC-015 says the
 * report belongs, so this is the correct surface rather than a workaround.
 *
 * Signing-courier prerequisite: beta's admin must own at least one calendar.
 * A report against a remote event has no owning local calendar to sign as, so
 * `forwardReport` resolves the admin's primary calendar to act as the
 * federation courier (its actor URI becomes the Flag's `actor` AND the
 * HTTP-Signature `keyId`). Without one the forward API returns 422. The
 * fixture creates that calendar explicitly rather than relying on seed data.
 *
 * Prerequisites:
 *   - Federation environment running: npm run federation:start
 *   - /etc/hosts entries for alpha.federation.local and beta.federation.local
 */

import { test, expect } from '@playwright/test';
import {
  INSTANCE_ALPHA,
  INSTANCE_BETA,
  formatRemoteCalendarId,
  generateCalendarName,
  getAlphaLogLineCount,
  waitForAlphaInboxActivity,
} from './helpers/instances';
import {
  getToken,
  createCalendar,
  createEvent,
  followCalendar,
  getFeed,
  submitAdminReport,
  forwardReportToAdmin,
  getCalendarReports,
} from './helpers/api';
import type { ReportResponse } from './helpers/api';

/**
 * Category carried on the Flag as a `#<category>` Hashtag and re-parsed by
 * the receiving handler. Asserting it round-trips is what covers the tag
 * encoding; a category the receiver cannot parse silently degrades to
 * `other`, which this spec would catch.
 */
const REPORT_CATEGORY = 'spam';

/**
 * Poll beta's feed until the federated event arrives, and return beta's LOCAL
 * row for it. Beta mints its own UUID for a remote event, so the report API
 * — which takes a local event id — cannot be given alpha's UUID.
 */
async function waitForFederatedEvent(
  betaToken: string,
  betaCalendarId: string,
  alphaEventId: string,
  timeoutMs = 20000,
): Promise<{ id: string; eventSourceUrl?: string }> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const feed = await getFeed(INSTANCE_BETA, betaToken, betaCalendarId);
    const match = feed.events.find(e => e.eventSourceUrl?.includes(alphaEventId));
    if (match) {
      return match;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Alpha event ${alphaEventId} never appeared in beta's feed; cannot file a report against it`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * Poll alpha's calendar-owner report queue until the federated report for the
 * given event is filed. The Flag is processed asynchronously after the inbox
 * write, so acceptance in the log precedes the report row by a short margin.
 */
async function waitForFederatedReport(
  alphaToken: string,
  alphaCalendarId: string,
  alphaEventId: string,
  timeoutMs = 15000,
): Promise<ReportResponse[]> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    // Unfiltered: the API rejects `source=federation` with 400 (its filter
    // enum omits the federation reporter type), so the whole queue is read
    // and matched here. The calendar is created fresh by this fixture, so
    // the queue's total contents are themselves assertable.
    const queue = await getCalendarReports(INSTANCE_ALPHA, alphaToken, alphaCalendarId);
    if (queue.reports.some(r => r.eventId === alphaEventId)) {
      return queue.reports;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `No report filed against alpha event ${alphaEventId} within ${timeoutMs}ms`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

test.describe.serial('Flag federation', () => {
  test('forwarded report is delivered to alpha and filed in the origin calendar queue', async () => {
    // ---- Fixture: beta follows alpha ----
    const alphaToken = await getToken(
      INSTANCE_ALPHA,
      INSTANCE_ALPHA.adminEmail,
      INSTANCE_ALPHA.adminPassword,
    );
    const betaToken = await getToken(
      INSTANCE_BETA,
      INSTANCE_BETA.adminEmail,
      INSTANCE_BETA.adminPassword,
    );

    const alphaCalendar = await createCalendar(INSTANCE_ALPHA, alphaToken, {
      urlName: generateCalendarName('af'),
      content: { en: { name: 'Alpha Flag Federation Calendar' } },
    });

    // Owned by beta's admin, so it doubles as the signing courier the forward
    // path requires (see the signing-courier prerequisite above).
    const betaCalendar = await createCalendar(INSTANCE_BETA, betaToken, {
      urlName: generateCalendarName('bf'),
      content: { en: { name: 'Beta Flag Federation Calendar' } },
    });

    const alphaRemoteId = formatRemoteCalendarId(alphaCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, betaToken, betaCalendar.id, alphaRemoteId);

    // Allow the Follow/Accept handshake to settle before publishing.
    await new Promise(resolve => setTimeout(resolve, 3000));

    const eventTitle = `Flag Federation Target ${Date.now()}`;
    const alphaEvent = await createEvent(INSTANCE_ALPHA, alphaToken, {
      calendarId: alphaCalendar.id,
      content: {
        en: {
          title: eventTitle,
          description: 'Event that beta will report back to alpha',
        },
      },
      startTime: '2026-09-01T18:00:00Z',
      endTime: '2026-09-01T20:00:00Z',
    });

    const betaEvent = await waitForFederatedEvent(betaToken, betaCalendar.id, alphaEvent.id);

    // The report targets beta's LOCAL id; the Flag must nonetheless carry
    // alpha's IRI as its object, or alpha cannot resolve the event.
    expect(
      betaEvent.id,
      'beta must mint its own local id for the federated event',
    ).not.toBe(alphaEvent.id);

    // ---- File the report on beta ----
    const report = await submitAdminReport(INSTANCE_BETA, betaToken, {
      eventId: betaEvent.id,
      category: REPORT_CATEGORY,
      description: 'Federated moderation report filed by beta against an alpha event',
      priority: 'medium',
    });
    expect(report.id, 'beta must return the created admin report').toBeTruthy();
    expect(
      report.calendarId,
      'a report against a remote event has no owning local calendar',
    ).toBeNull();

    // ---- Forward it, anchoring alpha's log first ----
    // Anchored BEFORE the forward so the log assertion can only match records
    // emitted by THIS action, never a stale record from an earlier test.
    const anchor = getAlphaLogLineCount();

    await forwardReportToAdmin(INSTANCE_BETA, betaToken, report.id);

    // WIRE: alpha's calendar inbox ACCEPTED a Flag naming alpha's event.
    // Acceptance, not arrival -- the arrival log line is emitted before
    // validation, so a Flag alpha then rejected with 400 would satisfy an
    // arrival-based assertion. Using alpha's event UUID as the needle also
    // pins the Flag's `object`: a Flag carrying beta's local URI (the shape
    // `buildFlagActivity` produces when no origin URI is supplied) would not
    // match, and alpha could not resolve the event from it either.
    const flagDelivered = await waitForAlphaInboxActivity('Flag', alphaEvent.id, anchor);
    expect(
      flagDelivered,
      'Flag naming the alpha event IRI must be accepted by alpha\'s calendar inbox',
    ).toBe(true);

    // ---- Receive side (LOAD-BEARING): the report is filed on alpha ----
    // The log record above proves ap_inbox admission only -- it is emitted
    // right after the inbox row is written and BEFORE dispatch, so a Flag
    // later dropped as misdirected, throttled by the per-instance cap, or
    // refused because the sender is blocked would still produce it. Only the
    // queue below proves the Flag was acted on.
    const queue = await waitForFederatedReport(alphaToken, alphaCalendar.id, alphaEvent.id);

    // The calendar is created by this fixture and carries exactly one event,
    // so the forwarded Flag must be the only thing in its queue -- a second
    // row would mean the Flag was filed twice.
    expect(queue.length, 'the forwarded Flag must file exactly one report').toBe(1);
    const received = queue[0];

    expect(received.reporterType, 'inbound Flags are filed as federation reports').toBe('federation');
    expect(received.category, 'the category Hashtag must survive the round trip').toBe(REPORT_CATEGORY);
    expect(
      received.forwardedFromInstance,
      'the reporting instance is derived from the Flag actor hostname',
    ).toBe(INSTANCE_BETA.domain);
    // DEC-015: a federated report is owned by the calendar that hosts the
    // reported event, so it lands in that calendar's tier-1 queue -- asserted
    // here rather than assumed from the queue it was fetched through.
    expect(
      received.calendarId,
      'the report must be scoped to alpha\'s owning calendar',
    ).toBe(alphaCalendar.id);
    expect(received.status, 'a received federated report starts as submitted').toBe('submitted');
  });
});
