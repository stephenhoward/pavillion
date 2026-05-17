/**
 * Note Activity Federation
 *
 * Bead context: pv-o3ay.3 -- empirical proof that the paired Create(Note) /
 * Update(Note) / Delete(Note) activities Pavillion emits for Mastodon-class
 * peers actually reach a remote inbox, and that the receiving Pavillion
 * inbox guards (commit 08e7df6) silently skip them without producing a
 * Note-derived side effect.
 *
 * Outbound emission (alpha):
 *   src/server/activitypub/events/index.ts handlers for event create / update /
 *   delete each emit a paired Note activity addressed to followers alongside
 *   the canonical Event activity. The Note IRI is `${eventIri}/note`.
 *
 * Inbound skip (beta):
 *   src/server/activitypub/service/inbox.ts short-circuits Create / Update /
 *   Delete activities whose object IRI ends with `/note` (or whose Tombstone
 *   `formerType` is `Note`). The log line that records "Received inbox
 *   activity" is emitted BEFORE the skip decision, so a log-poll proof is the
 *   only reliable observable that the Note variant actually arrived.
 *
 * Coverage (one fixture, three phases):
 *   - beta follows alpha's calendar
 *   - alpha creates an event   -> primary: Create(Note IRI) seen in beta inbox
 *   - alpha updates the event  -> primary: Update(Note IRI) seen in beta inbox
 *   - alpha deletes the event  -> primary: Delete(Note IRI) seen in beta inbox
 *
 * Secondary assertion (intentionally loose): beta's feed must not contain a
 * Note-derived side effect — no duplicate row for the same event, no row whose
 * source URL points at the Note IRI. The canonical Announce(Event) /
 * Update(Event) / Delete(Event) still produces the standard feed entry; the
 * Note paired emissions must not add a second one.
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
  getBetaLogLineCount,
  waitForBetaInboxActivity,
} from './helpers/instances';
import {
  getToken,
  createCalendar,
  createEvent,
  updateEvent,
  deleteEvent,
  followCalendar,
  getFeed,
} from './helpers/api';

test.describe.serial('Note federation', () => {
  test('emits Create/Update/Delete(Note) and beta skips them without side effects', async () => {
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
      urlName: generateCalendarName('an'),
      content: { en: { name: 'Alpha Note Federation Calendar' } },
    });
    const betaCalendar = await createCalendar(INSTANCE_BETA, betaToken, {
      urlName: generateCalendarName('bn'),
      content: { en: { name: 'Beta Note Federation Calendar' } },
    });

    const alphaRemoteId = formatRemoteCalendarId(alphaCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, betaToken, betaCalendar.id, alphaRemoteId);

    // Allow Follow/Accept handshake to settle before triggering event activity.
    await new Promise(resolve => setTimeout(resolve, 3000));

    // ---- Phase 1: Create ----
    // Anchor BEFORE the create so the log assertion can only match entries
    // emitted by THIS action, not stale entries from earlier tests or runs.
    const anchorCreate = getBetaLogLineCount();

    const createTitle = `Note Federation Create ${Date.now()}`;
    const event = await createEvent(INSTANCE_ALPHA, alphaToken, {
      calendarId: alphaCalendar.id,
      content: {
        en: {
          title: createTitle,
          description: 'Paired Create(Note) federation test',
        },
      },
      startTime: '2026-08-01T18:00:00Z',
      endTime: '2026-08-01T20:00:00Z',
    });

    // Note IRI shape is the canonical event IRI with `/note` appended.
    // See src/server/activitypub/model/object/note.ts NoteObject.noteUrl.
    const eventIri = `${INSTANCE_ALPHA.baseUrl}/calendars/${alphaCalendar.urlName}/events/${event.id}`;
    const noteIri = `${eventIri}/note`;

    // PRIMARY: Create(Note) reached beta's inbox handler. The inbox-guard
    // skip path (08e7df6) fires AFTER the "Received inbox activity" log entry,
    // so the log line is the only reliable observable for the Note variant.
    const createDelivered = await waitForBetaInboxActivity('Create', noteIri, anchorCreate);
    expect(
      createDelivered,
      'Create(Note) must reach beta inbox handler with the paired Note IRI',
    ).toBe(true);

    // SECONDARY: no Note-derived side effect on beta. The canonical
    // Announce(Event) still produces the standard feed row for this event;
    // the paired Create(Note) must not produce a duplicate row, nor a row
    // whose source URL points at the Note IRI.
    const feedAfterCreate = await getFeed(INSTANCE_BETA, betaToken, betaCalendar.id);
    const matchingRows = feedAfterCreate.events.filter(
      e => e.content?.en?.title === createTitle || e.eventSourceUrl?.endsWith('/note'),
    );
    expect(
      matchingRows.length,
      'beta feed must not contain a Note-derived duplicate row for the event',
    ).toBeLessThanOrEqual(1);
    expect(
      feedAfterCreate.events.some(e => e.eventSourceUrl?.endsWith('/note')),
      'beta feed must not contain any row whose source URL is the Note IRI',
    ).toBe(false);

    // ---- Phase 2: Update ----
    const anchorUpdate = getBetaLogLineCount();

    const updateTitle = `Note Federation Update ${Date.now()}`;
    await updateEvent(INSTANCE_ALPHA, alphaToken, event.id, {
      calendarId: alphaCalendar.id,
      content: {
        en: {
          title: updateTitle,
          description: 'Paired Update(Note) federation test',
        },
      },
      startTime: '2026-08-01T18:00:00Z',
      endTime: '2026-08-01T20:00:00Z',
    });

    const updateDelivered = await waitForBetaInboxActivity('Update', noteIri, anchorUpdate);
    expect(
      updateDelivered,
      'Update(Note) must reach beta inbox handler with the paired Note IRI',
    ).toBe(true);

    // No Note-derived side effect on beta: the canonical Update(Event) keeps
    // the existing row in sync (one row, refreshed title); the paired
    // Update(Note) must not add a Note-typed row.
    const feedAfterUpdate = await getFeed(INSTANCE_BETA, betaToken, betaCalendar.id);
    expect(
      feedAfterUpdate.events.some(e => e.eventSourceUrl?.endsWith('/note')),
      'beta feed must not contain any row whose source URL is the Note IRI after Update(Note)',
    ).toBe(false);

    // ---- Phase 3: Delete ----
    const anchorDelete = getBetaLogLineCount();

    await deleteEvent(INSTANCE_ALPHA, alphaToken, event.id, alphaCalendar.id);

    const deleteDelivered = await waitForBetaInboxActivity('Delete', noteIri, anchorDelete);
    expect(
      deleteDelivered,
      'Delete(Note) must reach beta inbox handler with the paired Note IRI',
    ).toBe(true);

    // No Note-derived side effect on beta after Delete(Note). The canonical
    // Delete(Event) is processed via its own path; the paired Delete(Note)
    // short-circuits inside the inbox guard and must not leave a phantom row.
    const feedAfterDelete = await getFeed(INSTANCE_BETA, betaToken, betaCalendar.id);
    expect(
      feedAfterDelete.events.some(e => e.eventSourceUrl?.endsWith('/note')),
      'beta feed must not contain any row whose source URL is the Note IRI after Delete(Note)',
    ).toBe(false);
  });
});
