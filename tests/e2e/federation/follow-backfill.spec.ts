/**
 * Follow Backfill Tests (pv-cug3)
 *
 * These tests verify that when a Pavillion calendar follows a remote calendar,
 * the follower's feed surfaces the source calendar's existing event history —
 * not just events the source Announces after the follow lands.
 *
 * Backfill flow exercised here:
 * 1. Source calendar (Alice on Alpha) creates N public events.
 * 2. Follower calendar (Bob on Beta) follows Alice.
 * 3. Alpha sends Accept(Follow); Beta's processAcceptActivity emits
 *    activitypub:follow:accepted, which the AP-domain handler turns into an
 *    activitypub:follow:backfill pg-boss job (pv-cug3.3).
 * 4. The worker (pv-cug3.4) signs an outbound GET to Alice's outbox
 *    (pv-cug3.1), paginates through the OrderedCollection, routes each
 *    surviving Create activity through ActivityPubInterface.processInboxMessage,
 *    and respects existing dismissal/policy gates.
 * 5. Bob's feed surfaces all N pre-existing events.
 *
 * Idempotency: unfollowing and re-following triggers a second Accept(Follow)
 * and a second backfill job; the unique constraints on ap_event_object.ap_id
 * and (event_id, calendar_id) on ap_shared_event ensure no duplicate rows.
 *
 * Prerequisites:
 * - Federation environment running: npm run federation:start
 * - /etc/hosts entries for alpha.federation.local and beta.federation.local
 */

import { test, expect } from '@playwright/test';
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
  unfollowCalendar,
  getFeed,
  getFollows,
} from './helpers/api';

const BACKFILL_DRAIN_MS = 15_000;
const FOLLOW_PROCESS_MS = 3_000;

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

  test('Backfill surfaces pre-existing source events in follower feed', async () => {
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('abf'),
      content: {
        en: { name: 'Alice Backfill Source' },
      },
    });

    const eventTitles: string[] = [];
    const baseTimestamp = Date.now();

    for (let i = 0; i < 5; i++) {
      const title = `Backfill Pre-Follow Event ${baseTimestamp}-${i}`;
      eventTitles.push(title);

      const startMonth = (3 + i).toString().padStart(2, '0');
      await createEvent(INSTANCE_ALPHA, aliceToken, {
        calendarId: aliceCalendar.id,
        content: {
          en: {
            title,
            description: `Pre-existing event ${i} created before any follow`,
          },
        },
        startTime: `2025-${startMonth}-15T14:00:00Z`,
        endTime: `2025-${startMonth}-15T16:00:00Z`,
      });
    }

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bbf'),
      content: {
        en: { name: 'Bob Backfill Follower' },
      },
    });

    const aliceCalendarRemoteId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);

    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarRemoteId);

    await new Promise(resolve => setTimeout(resolve, FOLLOW_PROCESS_MS + BACKFILL_DRAIN_MS));

    const feed = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);

    for (const title of eventTitles) {
      const count = feed.events.filter(e => e.content?.en?.title === title).length;
      expect(count, `expected exactly one feed row for "${title}" after initial backfill`).toBe(1);
    }
  });

  test('Re-following does not create duplicate backfill rows', async () => {
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('abi'),
      content: {
        en: { name: 'Alice Backfill Idempotency Source' },
      },
    });

    const eventTitles: string[] = [];
    const baseTimestamp = Date.now();

    for (let i = 0; i < 3; i++) {
      const title = `Backfill Idempotency Event ${baseTimestamp}-${i}`;
      eventTitles.push(title);

      const startMonth = (3 + i).toString().padStart(2, '0');
      await createEvent(INSTANCE_ALPHA, aliceToken, {
        calendarId: aliceCalendar.id,
        content: {
          en: {
            title,
            description: `Idempotency-check event ${i}`,
          },
        },
        startTime: `2025-${startMonth}-20T10:00:00Z`,
        endTime: `2025-${startMonth}-20T12:00:00Z`,
      });
    }

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bbi'),
      content: {
        en: { name: 'Bob Backfill Idempotency Follower' },
      },
    });

    const aliceCalendarRemoteId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);

    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarRemoteId);
    await new Promise(resolve => setTimeout(resolve, FOLLOW_PROCESS_MS + BACKFILL_DRAIN_MS));

    const feedAfterFirst = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);
    const firstRunCounts = new Map<string, number>();
    for (const title of eventTitles) {
      const count = feedAfterFirst.events.filter(e => e.content?.en?.title === title).length;
      expect(count, `expected exactly one feed row for "${title}" after first backfill`).toBe(1);
      firstRunCounts.set(title, count);
    }

    const followsBeforeUnfollow = await getFollows(INSTANCE_BETA, bobToken, bobCalendar.id);
    const aliceFollow = followsBeforeUnfollow.find(
      f => f.calendarActorId === aliceCalendarRemoteId ||
           f.calendarActorId.includes(aliceCalendar.urlName),
    );
    expect(aliceFollow, 'expected follow row before unfollow').toBeDefined();

    await unfollowCalendar(INSTANCE_BETA, bobToken, aliceFollow!.id, bobCalendar.id, aliceCalendarRemoteId);
    await new Promise(resolve => setTimeout(resolve, FOLLOW_PROCESS_MS));

    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarRemoteId);
    await new Promise(resolve => setTimeout(resolve, FOLLOW_PROCESS_MS + BACKFILL_DRAIN_MS));

    const feedAfterSecond = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);
    for (const title of eventTitles) {
      const count = feedAfterSecond.events.filter(e => e.content?.en?.title === title).length;
      expect(count, `expected exactly one feed row for "${title}" after re-follow (no duplicates)`).toBe(1);
    }
  });
});
