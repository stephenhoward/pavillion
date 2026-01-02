/**
 * Event Propagation Tests
 *
 * These tests verify that events created on one instance are properly
 * federated to followers on other instances via ActivityPub.
 *
 * Event Creation Flow:
 * 1. Beta follows Alpha's calendar
 * 2. Alpha creates a new event on her calendar
 * 3. Alpha's instance sends a Create(Event) activity to all followers
 * 4. Beta's instance receives the activity and adds the event to Beta's feed
 *
 * Event Update Flow:
 * 1. Alpha updates an existing event
 * 2. Alpha's instance sends an Update(Event) activity to all followers
 * 3. Beta's instance receives the activity and updates the event in Beta's feed
 *
 * Prerequisites:
 * - Federation environment running: npm run federation:start
 * - /etc/hosts entries for alpha.federation.local and beta.federation.local
 */

import { test, expect } from '@playwright/test';
import { INSTANCE_ALPHA, INSTANCE_BETA, formatRemoteCalendarId, generateCalendarName } from './helpers/instances';
import {
  getToken,
  createCalendar,
  createEvent,
  updateEvent,
  followCalendar,
  getFeed,
} from './helpers/api';

test.describe('Event Propagation', () => {
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

  test('Instance B follows Instance A calendar before event creation', async () => {
    // This test sets up the follow relationship that subsequent tests depend on
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('ae'),
      content: {
        en: { name: 'Alpha Events Test Calendar' },
      },
    });

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('be'),
      content: {
        en: { name: 'Beta Events Test Calendar' },
      },
    });

    // Use formatRemoteCalendarId for the follow API (format: calendar@domain)
    const aliceCalendarId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);

    // Beta follows Alpha
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarId);

    // Wait for follow to process
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify the follow exists by checking Beta's feed endpoint works
    const feed = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);
    expect(feed).toBeDefined();
    expect(feed.events).toBeDefined();
  });

  test('Event created on Instance A propagates to Instance B feed', async () => {
    // Create fresh calendars for this test
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('ap'),
      content: {
        en: { name: 'Alpha Propagation Test Calendar' },
      },
    });

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bp'),
      content: {
        en: { name: 'Beta Propagation Test Calendar' },
      },
    });

    // Beta follows Alpha
    const aliceCalendarId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarId);

    // Wait for follow to be established
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Alpha creates an event
    const eventTitle = `Test Event ${Date.now()}`;
    const event = await createEvent(INSTANCE_ALPHA, aliceToken, {
      calendarId: aliceCalendar.id,
      content: {
        en: {
          title: eventTitle,
          description: 'This event should propagate to followers',
        },
      },
      startTime: '2025-02-15T18:00:00Z',
      endTime: '2025-02-15T20:00:00Z',
    });

    expect(event.id).toBeDefined();

    // Wait for event to propagate via federation
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check Beta's feed for the event
    const feed = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);

    // Look for the event in Beta's feed
    const propagatedEvent = feed.events.find(
      (e) => e.content?.en?.title === eventTitle
    );

    expect(propagatedEvent).toBeDefined();
  });

  test('Create(Event) activity is delivered to Instance B', async () => {
    // This test verifies the Create activity mechanism
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('ac'),
      content: {
        en: { name: 'Alpha Create Activity Test' },
      },
    });

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bc'),
      content: {
        en: { name: 'Beta Create Activity Test' },
      },
    });

    // Beta follows Alpha
    const aliceCalendarId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarId);

    // Wait for follow
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get initial feed state
    const feedBefore = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);
    const initialEventCount = feedBefore.events.length;

    // Alpha creates an event
    const uniqueTitle = `Create Activity Test ${Date.now()}`;
    await createEvent(INSTANCE_ALPHA, aliceToken, {
      calendarId: aliceCalendar.id,
      content: {
        en: {
          title: uniqueTitle,
          description: 'Testing Create activity delivery',
        },
      },
      startTime: '2025-03-01T10:00:00Z',
      endTime: '2025-03-01T12:00:00Z',
    });

    // Wait for propagation
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check that a new event appeared in Beta's feed
    const feedAfter = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);

    expect(feedAfter.events.length).toBeGreaterThan(initialEventCount);

    // Verify the specific event is present
    const newEvent = feedAfter.events.find(
      (e) => e.content?.en?.title === uniqueTitle
    );
    expect(newEvent).toBeDefined();
  });

  test('Event appears in Instance B feed after propagation', async () => {
    // This test focuses on the feed display aspect
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('af'),
      content: {
        en: { name: 'Alpha Feed Display Test' },
      },
    });

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bf'),
      content: {
        en: { name: 'Beta Feed Display Test' },
      },
    });

    // Beta follows Alpha
    const aliceCalendarId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarId);

    // Wait for follow
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Create multiple events to ensure feed population
    const eventTitles = [
      `Feed Event 1 - ${Date.now()}`,
      `Feed Event 2 - ${Date.now()}`,
    ];

    for (const title of eventTitles) {
      await createEvent(INSTANCE_ALPHA, aliceToken, {
        calendarId: aliceCalendar.id,
        content: {
          en: {
            title: title,
            description: 'Testing feed display',
          },
        },
        startTime: '2025-04-01T14:00:00Z',
        endTime: '2025-04-01T16:00:00Z',
      });
    }

    // Wait for propagation
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verify events appear in Beta's feed
    const feed = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);

    for (const title of eventTitles) {
      const event = feed.events.find(
        (e) => e.content?.en?.title === title
      );
      expect(event).toBeDefined();
    }
  });

  test('Event update on Instance A propagates to Instance B', async () => {
    // This test verifies Update activity propagation
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('au'),
      content: {
        en: { name: 'Alpha Update Test Calendar' },
      },
    });

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bu'),
      content: {
        en: { name: 'Beta Update Test Calendar' },
      },
    });

    // Beta follows Alpha
    const aliceCalendarId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarId);

    // Wait for follow
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Alpha creates an event
    const originalTitle = `Original Event Title ${Date.now()}`;
    const event = await createEvent(INSTANCE_ALPHA, aliceToken, {
      calendarId: aliceCalendar.id,
      content: {
        en: {
          title: originalTitle,
          description: 'This event will be updated',
        },
      },
      startTime: '2025-05-01T09:00:00Z',
      endTime: '2025-05-01T11:00:00Z',
    });

    // Wait for initial propagation
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verify event appeared in Beta's feed
    let feed = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);
    let originalEvent = feed.events.find(
      (e) => e.content?.en?.title === originalTitle
    );
    expect(originalEvent).toBeDefined();

    // Alpha updates the event
    const updatedTitle = `Updated Event Title ${Date.now()}`;
    await updateEvent(INSTANCE_ALPHA, aliceToken, event.id, {
      calendarId: aliceCalendar.id,
      content: {
        en: {
          title: updatedTitle,
          description: 'This event has been updated',
        },
      },
      startTime: '2025-05-01T09:00:00Z',
      endTime: '2025-05-01T11:00:00Z',
    });

    // Wait for update to propagate
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check Beta's feed for the updated event
    feed = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);

    const updatedEvent = feed.events.find(
      (e) => e.content?.en?.title === updatedTitle
    );

    expect(updatedEvent).toBeDefined();
  });

  test('Update(Event) activity propagates correctly', async () => {
    // This is an explicit test for the Update activity mechanism
    const aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('ax'),
      content: {
        en: { name: 'Alpha Update Activity Test' },
      },
    });

    const bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bx'),
      content: {
        en: { name: 'Beta Update Activity Test' },
      },
    });

    // Beta follows Alpha
    const aliceCalendarId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarId);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Create and propagate initial event
    const initialTitle = `Initial Title ${Date.now()}`;
    const event = await createEvent(INSTANCE_ALPHA, aliceToken, {
      calendarId: aliceCalendar.id,
      content: {
        en: { title: initialTitle },
      },
      startTime: '2025-06-01T10:00:00Z',
      endTime: '2025-06-01T12:00:00Z',
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Update the event with new title and description
    const finalTitle = `Final Updated Title ${Date.now()}`;
    const finalDescription = 'Updated description content';

    await updateEvent(INSTANCE_ALPHA, aliceToken, event.id, {
      calendarId: aliceCalendar.id,
      content: {
        en: {
          title: finalTitle,
          description: finalDescription,
        },
      },
      startTime: '2025-06-01T10:00:00Z',
      endTime: '2025-06-01T12:00:00Z',
    });

    // Wait for Update activity to propagate
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verify the update propagated to Beta
    const feed = await getFeed(INSTANCE_BETA, bobToken, bobCalendar.id);

    const propagatedUpdate = feed.events.find(
      (e) => e.content?.en?.title === finalTitle
    );

    expect(propagatedUpdate).toBeDefined();
  });
});
