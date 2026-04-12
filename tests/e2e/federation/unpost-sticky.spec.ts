/**
 * Sticky Unpost of Auto-Reposted Events
 *
 * This test verifies the end-to-end sticky-unpost invariant for events
 * that were auto-reposted via follow policy:
 *
 * 1. Beta follows Alpha with auto-repost originals enabled.
 * 2. Alpha publishes a new event X. Beta auto-reposts X onto its calendar.
 * 3. Beta's calendar owner unposts X (DELETE /api/v1/social/shares/:id).
 *    This is the same endpoint invoked by the Link2Off unpost button in the
 *    calendar event list, which opens a confirmation modal and then calls
 *    `calendarService.unshareReposted`. We drive the endpoint directly since
 *    the rest of the federation harness is API-driven.
 * 4. Alpha re-broadcasts X by editing the event (which triggers an Update
 *    activity to followers).
 * 5. The underlying event on Beta still reflects the Update (the Update
 *    activity is NOT gated — only re-share creation is), but the event does
 *    NOT reappear in Beta's calendar event list because the dismissal row
 *    blocks a new SharedEventEntity from being created.
 *
 * Prerequisites:
 * - Federation environment running: npm run federation:start
 * - /etc/hosts entries for alpha.federation.local and beta.federation.local
 *
 * Related bead: pv-xq9q.7
 * Design reference: docs/superpowers/specs/2026-04-11-unpost-reposted-events-design.md
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
  getFollows,
  updateFollowPolicy,
} from './helpers/api';

// Accept self-signed certificates for the local federation instances
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

test.describe('Sticky Unpost of Auto-Reposted Events', () => {
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

  test('Owner unposts an auto-reposted event and it does not come back after Alpha re-broadcasts', async () => {
    // --- Setup: create calendars on both instances -------------------------
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('aus'),
      content: {
        en: { name: 'Alice Sticky Unpost Test' },
      },
    });

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bus'),
      content: {
        en: { name: 'Bob Sticky Unpost Test' },
      },
    });

    // --- Beta follows Alpha and enables auto-repost originals --------------
    const aliceCalendarId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarId);

    // Wait for follow to establish
    await new Promise(resolve => setTimeout(resolve, 3000));

    const follows = await getFollows(INSTANCE_BETA, bobToken, bobCalendar.id);
    const aliceFollow = follows.find(
      f => f.calendarActorId === aliceCalendarId ||
           f.calendarActorId?.includes(aliceCalendar.urlName),
    );
    expect(aliceFollow).toBeDefined();

    await updateFollowPolicy(
      INSTANCE_BETA,
      bobToken,
      aliceFollow!.id,
      bobCalendar.id,
      true,  // auto-repost originals
      false, // don't auto-repost reposts
    );

    // Wait for policy update to take effect
    await new Promise(resolve => setTimeout(resolve, 2000));

    // --- Alpha publishes event X ------------------------------------------
    const originalTitle = `Sticky Unpost Event ${Date.now()}`;
    await createEvent(INSTANCE_ALPHA, aliceToken, {
      calendarId: aliceCalendar.id,
      content: {
        en: {
          title: originalTitle,
          description: 'This event should auto-repost to Bob, then be unposted.',
        },
      },
      startTime: '2026-05-01T18:00:00Z',
      endTime: '2026-05-01T20:00:00Z',
    });

    // Wait for federation propagation
    await new Promise(resolve => setTimeout(resolve, 10000));

    // --- Verify X was auto-reposted into Beta's calendar list -------------
    let bobCalendarEventsResponse = await getCalendarEvents(
      INSTANCE_BETA,
      bobToken,
      bobCalendar.urlName,
    );
    let bobCalendarEvents = await bobCalendarEventsResponse.json();
    const autoRepostedEvent = bobCalendarEvents.find(
      (e: any) => e.content?.en?.title === originalTitle,
    );
    expect(autoRepostedEvent).toBeDefined();

    // Where the API already computes it, assert the auto-repost status so we
    // know we're unposting an auto-reposted row rather than an owned event.
    // (The field may be omitted on older clients; fall back to isRepost.)
    if (autoRepostedEvent.repostStatus !== undefined) {
      expect(autoRepostedEvent.repostStatus).toBe('auto');
    }
    else {
      expect(autoRepostedEvent.isRepost).toBe(true);
    }

    // Confirm the event is also visible in Beta's feed
    const feedBefore = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);
    const feedEntryBefore = feedBefore.events.find(
      e => e.content?.en?.title === originalTitle,
    );
    expect(feedEntryBefore).toBeDefined();

    // --- Unpost X via the API the calendar event-list button invokes ------
    // The new Link2Off button in events-tab.vue calls
    // calendarService.unshareReposted(calendarId, eventId), which hits:
    //   DELETE /api/v1/social/shares/:eventId?calendarId=...
    const unpostResponse = await fetch(
      `${INSTANCE_BETA.baseUrl}/api/v1/social/shares/${encodeURIComponent(autoRepostedEvent.id)}?calendarId=${encodeURIComponent(bobCalendar.id)}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${bobToken}`,
        },
        // @ts-ignore - agent is not in the TypeScript types but works at runtime
        agent: httpsAgent,
      },
    );
    expect(unpostResponse.ok).toBe(true);

    // Give the Undo(Announce) + dismissal write time to settle
    await new Promise(resolve => setTimeout(resolve, 2000));

    // --- Verify X disappeared from Beta's calendar list -------------------
    bobCalendarEventsResponse = await getCalendarEvents(
      INSTANCE_BETA,
      bobToken,
      bobCalendar.urlName,
    );
    bobCalendarEvents = await bobCalendarEventsResponse.json();
    const afterUnpost = bobCalendarEvents.find(
      (e: any) => e.content?.en?.title === originalTitle,
    );
    expect(afterUnpost).toBeUndefined();

    // --- Alpha re-broadcasts X by editing it -----------------------------
    // Fetch Alice's current copy of the event so we can grab its ID
    const aliceCalendarEventsResponse = await getCalendarEvents(
      INSTANCE_ALPHA,
      aliceToken,
      aliceCalendar.urlName,
    );
    const aliceCalendarEvents = await aliceCalendarEventsResponse.json();
    const aliceOriginalEvent = aliceCalendarEvents.find(
      (e: any) => e.content?.en?.title === originalTitle,
    );
    expect(aliceOriginalEvent).toBeDefined();

    const updatedTitle = `${originalTitle} - UPDATED`;
    const updateResponse = await fetch(
      `${INSTANCE_ALPHA.baseUrl}/api/v1/events/${encodeURIComponent(aliceOriginalEvent.id)}`,
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
              title: updatedTitle,
              description: 'Re-broadcast after unpost',
            },
          },
          startTime: '2026-05-01T18:00:00Z',
          endTime: '2026-05-01T20:00:00Z',
        }),
        // @ts-ignore - agent is not in the TypeScript types but works at runtime
        agent: httpsAgent,
      },
    );
    expect(updateResponse.ok).toBe(true);

    // Wait for Update(Event) to federate to Beta
    await new Promise(resolve => setTimeout(resolve, 10000));

    // --- Assert X is still NOT on Beta's calendar list (sticky) ----------
    bobCalendarEventsResponse = await getCalendarEvents(
      INSTANCE_BETA,
      bobToken,
      bobCalendar.urlName,
    );
    bobCalendarEvents = await bobCalendarEventsResponse.json();

    // Neither the original nor the updated title should appear — dismissal
    // gates re-creation of the SharedEventEntity for this calendar.
    const stillUnpostedOriginal = bobCalendarEvents.find(
      (e: any) => e.content?.en?.title === originalTitle,
    );
    expect(stillUnpostedOriginal).toBeUndefined();

    const stillUnpostedUpdated = bobCalendarEvents.find(
      (e: any) => e.content?.en?.title === updatedTitle,
    );
    expect(stillUnpostedUpdated).toBeUndefined();

    // --- But the underlying event on Beta's feed DID sync the Update -----
    // The Update activity is not gated by dismissal, so the federated event
    // row still reflects the edit when consumed through the feed (which
    // reads from EventEntity, not SharedEventEntity).
    const feedAfter = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);
    const feedEntryAfter = feedAfter.events.find(
      e => e.content?.en?.title === updatedTitle,
    );
    expect(feedEntryAfter).toBeDefined();

    // And the stale-titled version should no longer be present in the feed
    // (since it's the same underlying EventEntity that just got renamed).
    const feedEntryStale = feedAfter.events.find(
      e => e.content?.en?.title === originalTitle,
    );
    expect(feedEntryStale).toBeUndefined();
  });
});
