/**
 * Auto-Repost Policy Enforcement Tests
 *
 * These tests verify that auto-repost policies work correctly across federated
 * Pavillion instances with different trust settings. Tests cover:
 *
 * 1. Auto-reposting originals when policy enabled
 * 2. Auto-reposting reposts when policy enabled
 * 3. No auto-repost when policy disabled
 * 4. Policy update takes effect on new events
 * 5. Self-origin loop prevention (cross-instance)
 * 6. Duplicate prevention across policy changes
 *
 * Federation Flow:
 * - Beta follows Alpha with auto-repost policy settings
 * - Alpha creates/shares events
 * - Events propagate to Beta's feed via ActivityPub
 * - Auto-repost policy determines if events also appear on Beta's calendar
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
  getFeed,
  getCalendarEvents,
  getFollows,
  updateFollowPolicy,
  shareEvent,
} from './helpers/api';

test.describe('Auto-Repost Policy Enforcement', () => {
  let aliceToken: string;
  let bobToken: string;

  test.beforeAll(async () => {
    // Get authentication tokens for both instances
    aliceToken = await getToken(
      INSTANCE_ALPHA,
      INSTANCE_ALPHA.adminEmail,
      INSTANCE_ALPHA.adminPassword
    );

    bobToken = await getToken(
      INSTANCE_BETA,
      INSTANCE_BETA.adminEmail,
      INSTANCE_BETA.adminPassword
    );
  });

  test('Scenario 1: Auto-repost originals when policy enabled', async () => {
    // Setup: Create calendars
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('ar1'),
      content: {
        en: { name: 'Alice Auto-Repost Test 1' },
      },
    });

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('br1'),
      content: {
        en: { name: 'Bob Auto-Repost Test 1' },
      },
    });

    // Bob follows Alice
    const aliceCalendarId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarId);

    // Wait for follow to establish
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Update follow policy to auto-repost originals
    const follows = await getFollows(INSTANCE_BETA, bobToken, bobCalendar.id);
    const aliceFollow = follows.find(
      f => f.calendarActorId === aliceCalendarId ||
           f.calendarActorId?.includes(aliceCalendar.urlName)
    );
    expect(aliceFollow).toBeDefined();

    await updateFollowPolicy(
      INSTANCE_BETA,
      bobToken,
      aliceFollow!.id,
      bobCalendar.id,
      true,  // auto-repost originals
      false  // don't auto-repost reposts
    );

    // Wait for policy update
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Alice creates an event
    const eventTitle = `Auto-Repost Test Event ${Date.now()}`;
    await createEvent(INSTANCE_ALPHA, aliceToken, {
      calendarId: aliceCalendar.id,
      content: {
        en: {
          title: eventTitle,
          description: 'This event should be auto-reposted to Bob\'s calendar',
        },
      },
      startTime: '2025-03-15T18:00:00Z',
      endTime: '2025-03-15T20:00:00Z',
    });

    // Wait for federation propagation
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Assertions: Event appears in Bob's feed
    const feed = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);
    const eventInFeed = feed.events.find(e => e.content?.en?.title === eventTitle);
    expect(eventInFeed).toBeDefined();

    // Assertions: Event also appears in Bob's calendar (auto-reposted)
    const calendarEventsResponse = await getCalendarEvents(INSTANCE_BETA, bobToken, bobCalendar.urlName);
    const calendarEvents = await calendarEventsResponse.json();
    const eventInCalendar = calendarEvents.find((e: any) => e.content?.en?.title === eventTitle);
    expect(eventInCalendar).toBeDefined();
  });

  test('Scenario 2: Auto-repost reposts when policy enabled', async () => {
    // Setup: Create 3 calendars
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('ar2'),
      content: {
        en: { name: 'Alice Auto-Repost Test 2' },
      },
    });

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('br2'),
      content: {
        en: { name: 'Bob Auto-Repost Test 2' },
      },
    });

    const charlieCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('cr2'),
      content: {
        en: { name: 'Charlie Auto-Repost Test 2' },
      },
    });

    // Bob follows Alice with auto-repost reposts enabled
    const aliceCalendarId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarId);

    // Wait for follow
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Update Bob's follow policy for Alice (auto-repost reposts)
    const bobFollows = await getFollows(INSTANCE_BETA, bobToken, bobCalendar.id);
    const bobFollowsAlice = bobFollows.find(
      f => f.calendarActorId === aliceCalendarId ||
           f.calendarActorId?.includes(aliceCalendar.urlName)
    );
    expect(bobFollowsAlice).toBeDefined();

    await updateFollowPolicy(
      INSTANCE_BETA,
      bobToken,
      bobFollowsAlice!.id,
      bobCalendar.id,
      false, // don't auto-repost originals
      true   // auto-repost reposts
    );

    // Alice follows Charlie to see Charlie's events in her feed
    const charlieCalendarId = formatRemoteCalendarId(charlieCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_ALPHA, aliceToken, aliceCalendar.id, charlieCalendarId);

    // Wait for follow
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Charlie creates an event
    const charlieEventTitle = `Charlie Event ${Date.now()}`;
    await createEvent(INSTANCE_ALPHA, aliceToken, {
      calendarId: charlieCalendar.id,
      content: {
        en: {
          title: charlieEventTitle,
          description: 'Event from Charlie',
        },
      },
      startTime: '2025-03-20T14:00:00Z',
      endTime: '2025-03-20T16:00:00Z',
    });

    // Wait for Charlie's event to propagate to Alice's feed
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Alice shares Charlie's event (creates a repost/Announce)
    // First, get the event from Alice's feed
    const aliceFeed = await getFeed(INSTANCE_ALPHA, aliceToken, aliceCalendar.id);
    const charlieEventInAliceFeed = aliceFeed.events.find(
      e => e.content?.en?.title === charlieEventTitle
    );
    expect(charlieEventInAliceFeed).toBeDefined();

    // Share the event to Alice's calendar
    // Use event_source_url for federated events (ActivityPub URL, not just UUID)
    // For events on the same instance, construct the full URL
    let eventUrl = charlieEventInAliceFeed!.event_source_url || charlieEventInAliceFeed!.id;
    // If event_source_url is just a path (starts with /), prepend the instance base URL
    if (eventUrl.startsWith('/')) {
      eventUrl = `${INSTANCE_ALPHA.baseUrl}${eventUrl}`;
    }
    // If it's still just a UUID, construct the full URL
    else if (!eventUrl.startsWith('http')) {
      eventUrl = `${INSTANCE_ALPHA.baseUrl}/events/${eventUrl}`;
    }
    await shareEvent(
      INSTANCE_ALPHA,
      aliceToken,
      aliceCalendar.id,
      eventUrl
    );

    // Wait for Alice's repost to propagate to Bob
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Assertions: Bob sees Charlie's event in his feed (via Alice's repost)
    const bobFeed = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);
    const charlieEventInBobFeed = bobFeed.events.find(
      e => e.content?.en?.title === charlieEventTitle
    );
    expect(charlieEventInBobFeed).toBeDefined();

    // Assertions: Charlie's event is auto-reposted to Bob's calendar
    const bobCalendarEventsResponse = await getCalendarEvents(INSTANCE_BETA, bobToken, bobCalendar.urlName);
    const bobCalendarEvents = await bobCalendarEventsResponse.json();
    const charlieEventInBobCalendar = bobCalendarEvents.find(
      (e: any) => e.content?.en?.title === charlieEventTitle
    );
    expect(charlieEventInBobCalendar).toBeDefined();
  });

  test('Scenario 3: No auto-repost when policy disabled', async () => {
    // Setup: Create calendars
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('ar3'),
      content: {
        en: { name: 'Alice Auto-Repost Test 3' },
      },
    });

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('br3'),
      content: {
        en: { name: 'Bob Auto-Repost Test 3' },
      },
    });

    // Bob follows Alice with auto-repost disabled
    const aliceCalendarId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarId);

    // Wait for follow
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify follow policy is disabled (default)
    const follows = await getFollows(INSTANCE_BETA, bobToken, bobCalendar.id);
    const aliceFollow = follows.find(
      f => f.calendarActorId === aliceCalendarId ||
           f.calendarActorId?.includes(aliceCalendar.urlName)
    );
    expect(aliceFollow).toBeDefined();
    expect(aliceFollow!.autoRepostOriginals).toBe(false);
    expect(aliceFollow!.autoRepostReposts).toBe(false);

    // Alice creates an event
    const eventTitle = `No Auto-Repost Event ${Date.now()}`;
    await createEvent(INSTANCE_ALPHA, aliceToken, {
      calendarId: aliceCalendar.id,
      content: {
        en: {
          title: eventTitle,
          description: 'This event should NOT be auto-reposted',
        },
      },
      startTime: '2025-03-25T10:00:00Z',
      endTime: '2025-03-25T12:00:00Z',
    });

    // Wait for federation
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Assertions: Event appears in Bob's feed (following works)
    const feed = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);
    const eventInFeed = feed.events.find(e => e.content?.en?.title === eventTitle);
    expect(eventInFeed).toBeDefined();

    // Assertions: Event does NOT appear in Bob's calendar (no auto-repost)
    const calendarEventsResponse = await getCalendarEvents(INSTANCE_BETA, bobToken, bobCalendar.urlName);
    const calendarEvents = await calendarEventsResponse.json();
    const eventInCalendar = calendarEvents.find((e: any) => e.content?.en?.title === eventTitle);
    expect(eventInCalendar).toBeUndefined();
  });

  test('Scenario 4: Policy update takes effect on new events', async () => {
    // Setup: Create calendars
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('ar4'),
      content: {
        en: { name: 'Alice Auto-Repost Test 4' },
      },
    });

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('br4'),
      content: {
        en: { name: 'Bob Auto-Repost Test 4' },
      },
    });

    // Bob follows Alice with auto-repost disabled
    const aliceCalendarId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarId);

    // Wait for follow
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Alice creates event1 (before policy update)
    const event1Title = `Event Before Policy ${Date.now()}`;
    await createEvent(INSTANCE_ALPHA, aliceToken, {
      calendarId: aliceCalendar.id,
      content: {
        en: {
          title: event1Title,
          description: 'Created before auto-repost enabled',
        },
      },
      startTime: '2025-04-01T10:00:00Z',
      endTime: '2025-04-01T12:00:00Z',
    });

    // Wait for federation
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Verify event1 is NOT auto-reposted
    let calendarEventsResponse = await getCalendarEvents(INSTANCE_BETA, bobToken, bobCalendar.urlName);
    let calendarEvents = await calendarEventsResponse.json();
    let event1InCalendar = calendarEvents.find((e: any) => e.content?.en?.title === event1Title);
    expect(event1InCalendar).toBeUndefined();

    // Update Bob's follow policy to enable auto-repost originals
    const follows = await getFollows(INSTANCE_BETA, bobToken, bobCalendar.id);
    const aliceFollow = follows.find(
      f => f.calendarActorId === aliceCalendarId ||
           f.calendarActorId?.includes(aliceCalendar.urlName)
    );
    expect(aliceFollow).toBeDefined();

    await updateFollowPolicy(
      INSTANCE_BETA,
      bobToken,
      aliceFollow!.id,
      bobCalendar.id,
      true,  // auto-repost originals
      false
    );

    // Wait for policy update
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Alice creates event2 (after policy update)
    const event2Title = `Event After Policy ${Date.now()}`;
    await createEvent(INSTANCE_ALPHA, aliceToken, {
      calendarId: aliceCalendar.id,
      content: {
        en: {
          title: event2Title,
          description: 'Created after auto-repost enabled',
        },
      },
      startTime: '2025-04-02T14:00:00Z',
      endTime: '2025-04-02T16:00:00Z',
    });

    // Wait for federation
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Assertions: event1 still NOT in Bob's calendar
    calendarEventsResponse = await getCalendarEvents(INSTANCE_BETA, bobToken, bobCalendar.urlName);
    calendarEvents = await calendarEventsResponse.json();
    event1InCalendar = calendarEvents.find((e: any) => e.content?.en?.title === event1Title);
    expect(event1InCalendar).toBeUndefined();

    // Assertions: event2 IS in Bob's calendar (new policy applied)
    const event2InCalendar = calendarEvents.find((e: any) => e.content?.en?.title === event2Title);
    expect(event2InCalendar).toBeDefined();
  });

  test('Scenario 5: Self-origin loop prevention (cross-instance)', async () => {
    // Setup: Create calendars
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('ar5'),
      content: {
        en: { name: 'Alice Auto-Repost Test 5' },
      },
    });

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('br5'),
      content: {
        en: { name: 'Bob Auto-Repost Test 5' },
      },
    });

    // Mutual follows with auto-repost enabled
    const aliceCalendarId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    const bobCalendarId = formatRemoteCalendarId(bobCalendar.urlName, INSTANCE_BETA);

    // Alice follows Bob
    await followCalendar(INSTANCE_ALPHA, aliceToken, aliceCalendar.id, bobCalendarId);

    // Bob follows Alice
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarId);

    // Wait for follows
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Enable auto-repost for both
    let aliceFollows = await getFollows(INSTANCE_ALPHA, aliceToken, aliceCalendar.id);
    const aliceFollowsBob = aliceFollows.find(
      f => f.calendarActorId === bobCalendarId ||
           f.calendarActorId?.includes(bobCalendar.urlName)
    );
    expect(aliceFollowsBob).toBeDefined();

    await updateFollowPolicy(
      INSTANCE_ALPHA,
      aliceToken,
      aliceFollowsBob!.id,
      aliceCalendar.id,
      true,  // auto-repost originals
      false
    );

    let bobFollows = await getFollows(INSTANCE_BETA, bobToken, bobCalendar.id);
    const bobFollowsAlice = bobFollows.find(
      f => f.calendarActorId === aliceCalendarId ||
           f.calendarActorId?.includes(aliceCalendar.urlName)
    );
    expect(bobFollowsAlice).toBeDefined();

    await updateFollowPolicy(
      INSTANCE_BETA,
      bobToken,
      bobFollowsAlice!.id,
      bobCalendar.id,
      true,  // auto-repost originals
      false
    );

    // Wait for policy updates
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Alice creates event1 on her calendar
    const event1Title = `Alice Original Event ${Date.now()}`;
    await createEvent(INSTANCE_ALPHA, aliceToken, {
      calendarId: aliceCalendar.id,
      content: {
        en: {
          title: event1Title,
          description: 'Event from Alice',
        },
      },
      startTime: '2025-04-10T18:00:00Z',
      endTime: '2025-04-10T20:00:00Z',
    });

    // Wait for federation
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Bob should see event1 in feed and auto-repost to his calendar
    let bobFeed = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);
    const event1InBobFeed = bobFeed.events.find(e => e.content?.en?.title === event1Title);
    expect(event1InBobFeed).toBeDefined();

    let bobCalendarEventsResponse = await getCalendarEvents(INSTANCE_BETA, bobToken, bobCalendar.urlName);
    let bobCalendarEvents = await bobCalendarEventsResponse.json();
    const event1InBobCalendar = bobCalendarEvents.find(
      (e: any) => e.content?.en?.title === event1Title
    );
    expect(event1InBobCalendar).toBeDefined();

    // Wait for Bob's repost to propagate back to Alice
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Assertions: Alice's feed shows event1 (from Bob's calendar via follow)
    const aliceFeed = await getFeed(INSTANCE_ALPHA, aliceToken, aliceCalendar.id);
    const event1InAliceFeed = aliceFeed.events.find(e => e.content?.en?.title === event1Title);
    expect(event1InAliceFeed).toBeDefined();

    // Assertions: Alice's calendar does NOT auto-repost event1 again (loop prevention)
    // The event should only appear once on Alice's calendar (the original)
    const aliceCalendarEventsResponse = await getCalendarEvents(
      INSTANCE_ALPHA,
      aliceToken,
      aliceCalendar.id
    );
    const aliceCalendarEvents = await aliceCalendarEventsResponse.json();
    const event1Occurrences = aliceCalendarEvents.filter(
      (e: any) => e.content?.en?.title === event1Title
    );

    // Should only have 1 occurrence (the original), not 2 (would indicate loop)
    expect(event1Occurrences.length).toBe(1);
  });

  test('Scenario 6: Duplicate prevention across policy changes', async () => {
    // Setup: Create calendars
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('ar6'),
      content: {
        en: { name: 'Alice Auto-Repost Test 6' },
      },
    });

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('br6'),
      content: {
        en: { name: 'Bob Auto-Repost Test 6' },
      },
    });

    // Bob follows Alice with auto-repost disabled
    const aliceCalendarId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarId);

    // Wait for follow
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Alice creates event1
    const event1Title = `Duplicate Prevention Event ${Date.now()}`;
    await createEvent(INSTANCE_ALPHA, aliceToken, {
      calendarId: aliceCalendar.id,
      content: {
        en: {
          title: event1Title,
          description: 'Event for duplicate prevention test',
        },
      },
      startTime: '2025-04-15T10:00:00Z',
      endTime: '2025-04-15T12:00:00Z',
    });

    // Wait for federation
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Bob manually shares event1 to his calendar
    const bobFeed = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);
    const event1InFeed = bobFeed.events.find(e => e.content?.en?.title === event1Title);
    expect(event1InFeed).toBeDefined();

    // Use event_source_url for federated events (ActivityPub URL, not just UUID)
    // event1 is from Alice (INSTANCE_ALPHA), so use Alpha's domain
    let eventUrl = event1InFeed!.event_source_url || event1InFeed!.id;
    // If event_source_url is just a path (starts with /), prepend the source instance base URL
    if (eventUrl.startsWith('/')) {
      eventUrl = `${INSTANCE_ALPHA.baseUrl}${eventUrl}`;
    }
    // If it's still just a UUID, construct the full URL using the source instance
    else if (!eventUrl.startsWith('http')) {
      eventUrl = `${INSTANCE_ALPHA.baseUrl}/events/${eventUrl}`;
    }
    await shareEvent(
      INSTANCE_BETA,
      bobToken,
      bobCalendar.id,
      eventUrl
    );

    // Wait for manual share
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify event1 is now on Bob's calendar (manual share)
    let bobCalendarEventsResponse = await getCalendarEvents(INSTANCE_BETA, bobToken, bobCalendar.urlName);
    let bobCalendarEvents = await bobCalendarEventsResponse.json();
    let event1InCalendar = bobCalendarEvents.filter(
      (e: any) => e.content?.en?.title === event1Title
    );
    expect(event1InCalendar.length).toBe(1); // Should have exactly 1 copy

    // Now enable auto-repost policy
    const follows = await getFollows(INSTANCE_BETA, bobToken, bobCalendar.id);
    const aliceFollow = follows.find(
      f => f.calendarActorId === aliceCalendarId ||
           f.calendarActorId?.includes(aliceCalendar.urlName)
    );
    expect(aliceFollow).toBeDefined();

    await updateFollowPolicy(
      INSTANCE_BETA,
      bobToken,
      aliceFollow!.id,
      bobCalendar.id,
      true,  // auto-repost originals
      false
    );

    // Wait for policy update
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Alice updates event1
    const event1UpdatedTitle = `${event1Title} - UPDATED`;
    const aliceCalendarEventsResponse = await getCalendarEvents(
      INSTANCE_ALPHA,
      aliceToken,
      aliceCalendar.id
    );
    const aliceCalendarEvents = await aliceCalendarEventsResponse.json();
    const event1OnAlice = aliceCalendarEvents.find(
      (e: any) => e.content?.en?.title === event1Title
    );
    expect(event1OnAlice).toBeDefined();

    await fetch(
      `${INSTANCE_ALPHA.baseUrl}/api/v1/events/${encodeURIComponent(event1OnAlice.id)}`,
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
              title: event1UpdatedTitle,
              description: 'Updated event',
            },
          },
          startTime: '2025-04-15T10:00:00Z',
          endTime: '2025-04-15T12:00:00Z',
        }),
      }
    );

    // Wait for update to propagate
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Assertions: Bob's calendar still has only ONE copy of event1
    bobCalendarEventsResponse = await getCalendarEvents(INSTANCE_BETA, bobToken, bobCalendar.urlName);
    bobCalendarEvents = await bobCalendarEventsResponse.json();
    const updatedEvent1InCalendar = bobCalendarEvents.filter(
      (e: any) => e.content?.en?.title === event1UpdatedTitle
    );

    // Should still have exactly 1 copy (the existing SharedEventEntity, not a duplicate)
    expect(updatedEvent1InCalendar.length).toBe(1);
  });
});
