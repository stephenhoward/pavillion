/**
 * Follow Backfill Tests (pv-wy2u.3.3)
 *
 * These tests verify that when a Pavillion calendar follows a remote calendar,
 * the follower's feed reflects the source calendar's existing event history —
 * not just events the source Announces after the follow lands — and that
 * mid-flight Update and Undo activities encountered during backfill replay
 * yield the correct follower-visible outcome.
 *
 * Backfill flow exercised here:
 *   1. Source calendar (Alice on Alpha) creates events and optionally edits
 *      or Undoes Announces before any follower exists.
 *   2. Follower calendar (Bob on Beta) follows Alice.
 *   3. Alpha sends Accept(Follow); Beta's processAcceptActivity emits
 *      `activitypub:follow:accepted`, the backfill worker pulls Alice's
 *      outbox and routes each surviving activity through
 *      `ActivityPubInterface.processInboxMessage`.
 *   4. The follower's feed (or calendar event list) reflects only the
 *      latest, non-Undone, post-Update state on the source.
 *
 * Three round-trip scenarios:
 *   - Base:   N pre-existing Create(Event) activities → follower sees N events.
 *   - Update: Create(Event v1) + Update(Event v2) → follower sees v2.
 *   - Undo:   Create(Event) + Announce + Undo(Announce) → follower has no
 *             share row for the event.
 *
 * Assertions exercise only follower-visible outcomes (feed entries, share
 * rows via the calendar event-list API). Internal `ap_inbox` ordering is
 * covered by integration tests at `pv-wy2u.2.5`.
 *
 * Prerequisites:
 * - Federation environment running: npm run federation:start
 * - /etc/hosts entries for alpha.federation.local and beta.federation.local
 */

import { test, expect } from '@playwright/test';
import https from 'https';
import {
  INSTANCE_ALPHA,
  INSTANCE_BETA,
  formatRemoteCalendarId,
  generateCalendarName,
} from './helpers/instances';
import {
  getToken,
  createCalendar,
  createEvent,
  followCalendar,
  getFeed,
  getCalendarEvents,
  shareEvent,
} from './helpers/api';

// Accept self-signed certificates for the local federation instances
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Federation timing: follow-Accept round-trip + backfill worker drain. The
// backfill job pulls the source outbox, paginates, and routes each activity
// through the inbox. These constants mirror the pattern from auto-repost.spec.ts
// (which uses ~10s for a single Create) plus headroom for the GET/pagination.
const FOLLOW_PROCESS_MS = 3_000;
const BACKFILL_DRAIN_MS = 15_000;

test.describe('Follow Backfill', () => {
  let aliceToken: string;
  let bobToken: string;

  test.beforeAll(async () => {
    aliceToken = await getToken(
      INSTANCE_ALPHA,
      INSTANCE_ALPHA.adminEmail,
      INSTANCE_ALPHA.adminPassword,
    );

    bobToken = await getToken(
      INSTANCE_BETA,
      INSTANCE_BETA.adminEmail,
      INSTANCE_BETA.adminPassword,
    );
  });

  test('Base round-trip: backfill surfaces pre-existing source events in follower feed', async () => {
    // --- Setup: Alice creates 3 events on her source calendar ---------------
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('abb'),
      content: {
        en: { name: 'Alice Backfill Base' },
      },
    });

    const baseTimestamp = Date.now();
    const eventTitles: string[] = [];
    for (let i = 0; i < 3; i++) {
      const title = `Backfill Base Event ${baseTimestamp}-${i}`;
      eventTitles.push(title);

      const startMonth = (3 + i).toString().padStart(2, '0');
      await createEvent(INSTANCE_ALPHA, aliceToken, {
        calendarId: aliceCalendar.id,
        content: {
          en: {
            title,
            description: `Pre-existing event ${i}`,
          },
        },
        startTime: `2025-${startMonth}-15T14:00:00Z`,
        endTime: `2025-${startMonth}-15T16:00:00Z`,
      });
    }

    // --- Bob follows Alice (triggers backfill) -----------------------------
    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bbb'),
      content: {
        en: { name: 'Bob Backfill Base' },
      },
    });

    const aliceCalendarRemoteId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarRemoteId);

    // Wait for follow Accept + backfill worker to drain
    await new Promise(resolve => setTimeout(resolve, FOLLOW_PROCESS_MS + BACKFILL_DRAIN_MS));

    // --- Assert: all 3 pre-existing events appear in Bob's feed exactly once
    const feed = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);

    for (const title of eventTitles) {
      const count = feed.events.filter(e => e.content?.en?.title === title).length;
      expect(
        count,
        `expected exactly one feed row for "${title}" after initial backfill`,
      ).toBe(1);
    }
  });

  test('Update round-trip: backfill of Create+Update yields the latest title on follower', async () => {
    // --- Setup: Alice creates event with title "v1" ------------------------
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('abu'),
      content: {
        en: { name: 'Alice Backfill Update' },
      },
    });

    const baseTimestamp = Date.now();
    const titleV1 = `Backfill Update Event ${baseTimestamp} v1`;
    const titleV2 = `Backfill Update Event ${baseTimestamp} v2`;

    await createEvent(INSTANCE_ALPHA, aliceToken, {
      calendarId: aliceCalendar.id,
      content: {
        en: {
          title: titleV1,
          description: 'Initial version',
        },
      },
      startTime: '2025-06-15T14:00:00Z',
      endTime: '2025-06-15T16:00:00Z',
    });

    // Give the Create activity time to settle on Alice's outbox before
    // editing — we want the outbox to contain Create(v1) THEN Update(v2)
    // when Bob's backfill worker walks it.
    await new Promise(resolve => setTimeout(resolve, 2_000));

    // --- Alice updates the event to "v2" before any follower exists --------
    // Fetch Alice's view of the event so we have its id for PUT.
    const aliceEventsResponse = await getCalendarEvents(
      INSTANCE_ALPHA,
      aliceToken,
      aliceCalendar.urlName,
    );
    const aliceEvents = await aliceEventsResponse.json();
    const aliceEventV1 = aliceEvents.find(
      (e: { content?: { en?: { title?: string } } }) => e.content?.en?.title === titleV1,
    );
    expect(aliceEventV1, 'expected Alice to have her own v1 event').toBeDefined();

    const updateResponse = await fetch(
      `${INSTANCE_ALPHA.baseUrl}/api/v1/events/${encodeURIComponent(aliceEventV1.id)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          calendarId: aliceCalendar.id,
          content: {
            en: {
              title: titleV2,
              description: 'Edited before any follower existed',
            },
          },
          schedules: [
            {
              start: '2025-06-15T14:00:00Z',
              eventEndTime: '2025-06-15T16:00:00Z',
            },
          ],
        }),
        // @ts-ignore - agent is not in the TypeScript types but works at runtime
        agent: httpsAgent,
      },
    );
    expect(updateResponse.ok).toBe(true);

    // Let the Update activity land in Alice's outbox
    await new Promise(resolve => setTimeout(resolve, 2_000));

    // --- Bob follows Alice (triggers backfill that walks Create + Update) --
    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bbu'),
      content: {
        en: { name: 'Bob Backfill Update' },
      },
    });

    const aliceCalendarRemoteId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarRemoteId);

    await new Promise(resolve => setTimeout(resolve, FOLLOW_PROCESS_MS + BACKFILL_DRAIN_MS));

    // --- Assert: Bob's feed shows v2 (latest title), not v1 ----------------
    const feed = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);
    const feedEntryV2 = feed.events.find(e => e.content?.en?.title === titleV2);
    expect(feedEntryV2, 'expected follower feed to show v2 after backfill').toBeDefined();

    const feedEntryV1 = feed.events.find(e => e.content?.en?.title === titleV1);
    expect(feedEntryV1, 'expected v1 title to NOT appear in follower feed (replaced by v2)').toBeUndefined();
  });

  test('Undo round-trip: backfill of Announce+Undo(Announce) yields no follower share row', async () => {
    // --- Setup: Alice creates an event and shares (Announces) it ----------
    // To produce an Announce on Alice's outbox that has a matching Undo
    // before any follower exists, Alice follows Charlie, Charlie creates
    // an event, Alice manually shares (Announces) it, then Alice unshares
    // (Undo(Announce)). When Bob later follows Alice, the backfill worker
    // walks her outbox containing Announce + Undo(Announce) and must end
    // with no share row on Bob's side.
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('abx'),
      content: {
        en: { name: 'Alice Backfill Undo' },
      },
    });

    const charlieCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('cbx'),
      content: {
        en: { name: 'Charlie Backfill Undo Source' },
      },
    });

    // Alice follows Charlie so Charlie's event lands in her feed and she
    // can manually share it.
    const charlieCalendarRemoteId = formatRemoteCalendarId(charlieCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_ALPHA, aliceToken, aliceCalendar.id, charlieCalendarRemoteId);
    await new Promise(resolve => setTimeout(resolve, FOLLOW_PROCESS_MS));

    const eventTitle = `Backfill Undo Event ${Date.now()}`;
    await createEvent(INSTANCE_ALPHA, aliceToken, {
      calendarId: charlieCalendar.id,
      content: {
        en: {
          title: eventTitle,
          description: 'Source event for Undo-during-backfill test',
        },
      },
      startTime: '2025-07-10T10:00:00Z',
      endTime: '2025-07-10T12:00:00Z',
    });

    // Wait for Charlie's event to propagate to Alice's feed
    await new Promise(resolve => setTimeout(resolve, 10_000));

    // Alice shares (Announces) Charlie's event to her calendar
    const aliceFeed = await getFeed(INSTANCE_ALPHA, aliceToken, aliceCalendar.id);
    const eventInAliceFeed = aliceFeed.events.find(
      e => e.content?.en?.title === eventTitle,
    );
    expect(eventInAliceFeed, 'expected Charlie\'s event to land in Alice\'s feed').toBeDefined();

    let eventUrl = eventInAliceFeed!.eventSourceUrl || eventInAliceFeed!.id;
    if (eventUrl.startsWith('/')) {
      eventUrl = `${INSTANCE_ALPHA.baseUrl}${eventUrl}`;
    }
    else if (!eventUrl.startsWith('http')) {
      eventUrl = `${INSTANCE_ALPHA.baseUrl}/events/${eventUrl}`;
    }

    await shareEvent(INSTANCE_ALPHA, aliceToken, aliceCalendar.id, eventUrl);

    // Wait for Announce to land in Alice's outbox
    await new Promise(resolve => setTimeout(resolve, 3_000));

    // Confirm Alice's calendar now lists the shared event (sanity check).
    const aliceCalendarEventsResponse = await getCalendarEvents(
      INSTANCE_ALPHA,
      aliceToken,
      aliceCalendar.urlName,
    );
    const aliceCalendarEvents = await aliceCalendarEventsResponse.json();
    const aliceSharedEvent = aliceCalendarEvents.find(
      (e: { content?: { en?: { title?: string } } }) => e.content?.en?.title === eventTitle,
    );
    expect(aliceSharedEvent, 'expected Alice\'s calendar to show the shared event after Announce').toBeDefined();

    // --- Alice Undoes the Announce (unposts) before any follower exists ---
    // DELETE /api/v1/social/shares/:eventId?calendarId=... is the endpoint
    // that emits Undo(Announce). The bead 3.1 strict-cross-check applies
    // when this Undo is replayed via backfill on Bob's instance.
    const unpostResponse = await fetch(
      `${INSTANCE_ALPHA.baseUrl}/api/v1/social/shares/${encodeURIComponent(aliceSharedEvent.id)}?calendarId=${encodeURIComponent(aliceCalendar.id)}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${aliceToken}`,
        },
        // @ts-ignore - agent is not in the TypeScript types but works at runtime
        agent: httpsAgent,
      },
    );
    expect(unpostResponse.ok).toBe(true);

    // Let Undo(Announce) land in Alice's outbox
    await new Promise(resolve => setTimeout(resolve, 3_000));

    // --- Bob follows Alice — backfill replays Announce + Undo(Announce) ---
    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bbx'),
      content: {
        en: { name: 'Bob Backfill Undo Follower' },
      },
    });

    const aliceCalendarRemoteId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarRemoteId);

    await new Promise(resolve => setTimeout(resolve, FOLLOW_PROCESS_MS + BACKFILL_DRAIN_MS));

    // --- Assert: Bob has NO share row for the Undone event ----------------
    // Bob's calendar event list (backed by SharedEventEntity) must not
    // contain the event — the Undo(Announce) replayed during backfill
    // must cancel the Announce.
    const bobCalendarEventsResponse = await getCalendarEvents(
      INSTANCE_BETA,
      bobToken,
      bobCalendar.urlName,
    );
    const bobCalendarEvents = await bobCalendarEventsResponse.json();
    const bobShareRow = bobCalendarEvents.find(
      (e: { content?: { en?: { title?: string } } }) => e.content?.en?.title === eventTitle,
    );
    expect(
      bobShareRow,
      'expected NO share row on Bob\'s calendar after backfill of Announce+Undo',
    ).toBeUndefined();
  });
});
