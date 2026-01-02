/**
 * WebFinger Discovery Tests
 *
 * These tests verify that WebFinger discovery works correctly between
 * two Pavillion instances. WebFinger is the first step in ActivityPub
 * federation - it allows one instance to discover the ActivityPub actor
 * URL for a calendar on another instance.
 *
 * WebFinger Flow:
 * 1. Beta queries alpha.federation.local's /.well-known/webfinger endpoint
 * 2. The query includes a resource parameter like "acct:calendar-name@alpha.federation.local"
 * 3. Alpha returns a JSON response with links to the ActivityPub profile
 * 4. Beta fetches the ActivityPub profile to get the actor details
 *
 * Prerequisites:
 * - Federation environment running: npm run federation:start
 * - /etc/hosts entries for alpha.federation.local and beta.federation.local
 */

import { test, expect } from '@playwright/test';
import { INSTANCE_ALPHA, formatWebFingerResource, generateCalendarName } from './helpers/instances';
import { getToken, createCalendar, getCalendars } from './helpers/api';

/**
 * Test: WebFinger discovery returns correct calendar actor information
 *
 * This test verifies the complete WebFinger discovery flow:
 * 1. Create a calendar on Alpha's instance
 * 2. Query Alpha's WebFinger endpoint from Beta's perspective
 * 3. Verify the WebFinger response contains the correct ActivityPub profile link
 * 4. Verify the profile URL returns a valid ActivityPub actor document
 */
test.describe('WebFinger Discovery', () => {
  let aliceToken: string;

  test.beforeAll(async () => {
    // Get authentication token for Alpha's admin
    aliceToken = await getToken(
      INSTANCE_ALPHA,
      INSTANCE_ALPHA.adminEmail,
      INSTANCE_ALPHA.adminPassword
    );
  });

  test('should discover calendar actor via WebFinger', async ({ request }) => {
    // Step 1: Create a calendar on Alpha's instance
    const testCalendarUrlName = generateCalendarName('wf_disc');
    const calendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: testCalendarUrlName,
      content: {
        en: { name: 'WebFinger Test Calendar' },
      },
    });

    expect(calendar.urlName).toBe(testCalendarUrlName);

    // Step 2: Query WebFinger endpoint from Beta's perspective
    // In a real federation scenario, Beta would make this request to discover Alpha's calendar
    const webfingerUrl = new URL('/.well-known/webfinger', INSTANCE_ALPHA.baseUrl);
    webfingerUrl.searchParams.set(
      'resource',
      formatWebFingerResource(testCalendarUrlName, INSTANCE_ALPHA)
    );

    const webfingerResponse = await request.get(webfingerUrl.toString());

    // Step 3: Verify WebFinger response
    expect(webfingerResponse.ok()).toBe(true);
    expect(webfingerResponse.headers()['content-type']).toContain('application/json');

    const webfingerData = await webfingerResponse.json();

    // Verify the subject matches the requested resource
    expect(webfingerData.subject).toBe(
      formatWebFingerResource(testCalendarUrlName, INSTANCE_ALPHA)
    );

    // Verify the response contains links
    expect(webfingerData.links).toBeDefined();
    expect(Array.isArray(webfingerData.links)).toBe(true);
    expect(webfingerData.links.length).toBeGreaterThan(0);

    // Find the ActivityPub profile link (rel: 'self', type: application/activity+json)
    const profileLink = webfingerData.links.find(
      (link: { rel: string; type?: string }) =>
        link.rel === 'self' && link.type === 'application/activity+json'
    );

    expect(profileLink).toBeDefined();
    expect(profileLink.href).toContain(`/o/${testCalendarUrlName}`);
  });

  test('should return valid ActivityPub actor document from profile URL', async ({ request }) => {
    // Create a calendar for this test
    const calendarUrlName = generateCalendarName('wf_actor');
    await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: calendarUrlName,
      content: {
        en: { name: 'Actor Test Calendar' },
      },
    });

    // Fetch the ActivityPub actor document directly
    const actorUrl = `${INSTANCE_ALPHA.baseUrl}/o/${calendarUrlName}`;
    const actorResponse = await request.get(actorUrl, {
      headers: {
        'Accept': 'application/activity+json',
      },
    });

    expect(actorResponse.ok()).toBe(true);

    const actorData = await actorResponse.json();

    // Verify required ActivityPub actor fields
    expect(actorData['@context']).toBeDefined();
    expect(actorData.type).toBe('Organization');
    expect(actorData.id).toContain(`/o/${calendarUrlName}`);

    // Verify inbox and outbox are present (required for federation)
    expect(actorData.inbox).toBeDefined();
    expect(actorData.outbox).toBeDefined();

    // Verify the preferred username matches the calendar URL name
    expect(actorData.preferredUsername).toBe(calendarUrlName);
  });

  test('should return 404 for non-existent calendar', async ({ request }) => {
    // Query WebFinger for a calendar that doesn't exist
    const webfingerUrl = new URL('/.well-known/webfinger', INSTANCE_ALPHA.baseUrl);
    webfingerUrl.searchParams.set(
      'resource',
      formatWebFingerResource('nonexistent_cal', INSTANCE_ALPHA)
    );

    const webfingerResponse = await request.get(webfingerUrl.toString());

    // Should return 404 for non-existent resource
    expect(webfingerResponse.status()).toBe(404);
  });

  test('should return 400 for invalid WebFinger request', async ({ request }) => {
    // Query WebFinger without a resource parameter
    const webfingerUrl = new URL('/.well-known/webfinger', INSTANCE_ALPHA.baseUrl);

    const webfingerResponse = await request.get(webfingerUrl.toString());

    // Should return 400 for missing resource parameter
    expect(webfingerResponse.status()).toBe(400);
  });

  test('Instance B can query Instance A WebFinger endpoint', async ({ request }) => {
    // This test simulates the cross-instance discovery scenario
    // Beta (Instance B) queries Alpha (Instance A) for calendar information

    // Create a calendar for cross-instance test
    const calendarUrlName = generateCalendarName('wf_cross');
    await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: calendarUrlName,
      content: {
        en: { name: 'Cross-Instance Test Calendar' },
      },
    });

    // Query from Beta's perspective (using request context which simulates external request)
    const webfingerUrl = new URL('/.well-known/webfinger', INSTANCE_ALPHA.baseUrl);
    webfingerUrl.searchParams.set(
      'resource',
      formatWebFingerResource(calendarUrlName, INSTANCE_ALPHA)
    );

    const webfingerResponse = await request.get(webfingerUrl.toString());

    expect(webfingerResponse.ok()).toBe(true);

    const webfingerData = await webfingerResponse.json();

    // Verify the profile link points to the correct instance
    const profileLink = webfingerData.links.find(
      (link: { rel: string; type?: string }) =>
        link.rel === 'self' && link.type === 'application/activity+json'
    );

    expect(profileLink).toBeDefined();
    expect(profileLink.href).toContain(INSTANCE_ALPHA.domain);
    expect(profileLink.href).toContain(`/o/${calendarUrlName}`);
  });
});
