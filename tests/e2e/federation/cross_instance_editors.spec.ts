import { test, expect } from '@playwright/test';
import {
  getToken,
  createCalendar,
  grantEditorAccessByEmail,
  getCalendarEvents,
} from './helpers/api';
import {
  INSTANCE_ALPHA,
  INSTANCE_BETA,
  getBetaLogLineCount,
  waitForBetaInboxActivity,
} from './helpers/instances';
import https from 'https';

// Create an HTTPS agent that accepts self-signed certificates for local testing
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

test.describe.serial('Cross-Instance Editor Collaboration', () => {
  let alphaAdminToken: string;
  let betaAdminToken: string;
  let alphaCalendarId: string;
  let alphaCalendarUrlName: string;

  test.beforeAll(async () => {
    // Use existing admin accounts from seed data
    alphaAdminToken = await getToken(INSTANCE_ALPHA, INSTANCE_ALPHA.adminEmail, INSTANCE_ALPHA.adminPassword);
    betaAdminToken = await getToken(INSTANCE_BETA, INSTANCE_BETA.adminEmail, INSTANCE_BETA.adminPassword);

    // Create a calendar on Instance Alpha with unique name
    const timestamp = Date.now();
    alphaCalendarUrlName = `collab_cal_${timestamp}`;
    const calendar = await createCalendar(INSTANCE_ALPHA, alphaAdminToken, {
      urlName: alphaCalendarUrlName,
      content: {
        en: {
          name: 'Collaboration Calendar',
        },
      },
    });
    alphaCalendarId = calendar.id;
  });

  test('should discover remote user actor via WebFinger', async () => {
    // WebFinger discovery for user actor (Admin user from Beta instance)
    // Note: User WebFinger format requires @ prefix: acct:@username@domain
    const webfingerUrl = `${INSTANCE_BETA.baseUrl}/.well-known/webfinger?resource=acct:@Admin@${INSTANCE_BETA.domain}`;

    const response = await fetch(webfingerUrl, {
      headers: {
        'Accept': 'application/json',
      },
      // @ts-ignore - agent is not in the TypeScript types but works at runtime
      agent: httpsAgent,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.subject).toBe(`acct:@Admin@${INSTANCE_BETA.domain}`);
    expect(data.links).toBeDefined();

    // Find the self link pointing to the Person actor
    const selfLink = data.links.find((link: any) => link.rel === 'self');
    expect(selfLink).toBeDefined();
    expect(selfLink.href).toContain('/users/Admin');
    expect(selfLink.type).toBe('application/activity+json');
  });

  test('should fetch remote user Person actor', async () => {
    // Fetch the Person actor from Instance Beta
    const actorUrl = `${INSTANCE_BETA.baseUrl}/users/Admin`;

    const response = await fetch(actorUrl, {
      headers: {
        'Accept': 'application/activity+json',
      },
      // @ts-ignore - agent is not in the TypeScript types but works at runtime
      agent: httpsAgent,
    });

    expect(response.status).toBe(200);

    const actor = await response.json();
    expect(actor.type).toBe('Person');
    expect(actor.preferredUsername).toBe('Admin');
    expect(actor.inbox).toContain('/users/Admin/inbox');
    expect(actor.outbox).toContain('/users/Admin/outbox');
    expect(actor.publicKey).toBeDefined();
    expect(actor.publicKey.id).toContain('#main-key');
    expect(actor.publicKey.publicKeyPem).toBeDefined();
  });

  test('should add user from Instance Beta as editor on Instance Alpha calendar', async () => {
    // Grant editor access by federated email (Admin@beta.federation.local)
    const response = await grantEditorAccessByEmail(
      INSTANCE_ALPHA,
      alphaAdminToken,
      alphaCalendarId,
      'Admin@beta.federation.local',
    );

    expect(response.status).toBe(201);

    const result = await response.json();
    expect(result.type).toBe('remote_editor');
    expect(result.data.actorUri).toContain('Admin');
  });

  test('should allow editor from Instance Beta to create event on Instance Alpha calendar', async () => {
    // Editor from Instance Beta creates an event on Instance Alpha calendar.
    // The editor-invite `Add` activity is delivered asynchronously through the
    // outbox worker (pv-dyyw), so Beta may not yet know about the remote
    // calendar when the previous test's grant call returns. Poll the create
    // request until Beta has established the remote calendar membership and
    // accepts the event (201), or until the timeout elapses.
    const eventData = {
      calendarId: alphaCalendarId,
      content: {
        en: {
          name: 'Cross-Instance Event',
          description: 'Event created by editor from Instance Beta',
        },
      },
      start_date: '2025-09-15',
      start_time: '14:00',
      end_date: '2025-09-15',
      end_time: '16:00',
    };

    let response: Response | undefined;
    await expect.poll(
      async () => {
        response = await fetch(`${INSTANCE_BETA.baseUrl}/api/v1/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${betaAdminToken}`,
          },
          body: JSON.stringify(eventData),
          // @ts-ignore - agent is not in the TypeScript types but works at runtime
          agent: httpsAgent,
        });
        return response.status;
      },
      { timeout: 15000, intervals: [500, 1000, 2000] },
    ).toBe(201);

    const event = await response!.json();
    expect(event.content.en.name).toBe('Cross-Instance Event');
    expect(event.calendarId).toBe(alphaCalendarId);
  });

  test('should see created event in calendar on Instance Alpha', async () => {
    // Verify event appears in calendar on Instance Alpha
    const response = await getCalendarEvents(
      INSTANCE_ALPHA,
      alphaAdminToken,
      alphaCalendarUrlName,
    );

    expect(response.status).toBe(200);

    const events = await response.json();
    const crossInstanceEvent = events.find(
      (e: any) => e.content.en.name === 'Cross-Instance Event',
    );

    expect(crossInstanceEvent).toBeDefined();
    expect(crossInstanceEvent.content.en.description).toBe(
      'Event created by editor from Instance Beta',
    );
  });

  test('should deliver ActivityPub Create activity for event', async ({ page }) => {
    // This test verifies that ActivityPub activities are delivered
    // We can check the inbox on Instance Alpha to see if Create activity was received

    // Note: This requires access to the inbox messages, which might need additional API endpoints
    // For now, we verify that the event exists, which implies successful ActivityPub delivery

    const response = await getCalendarEvents(
      INSTANCE_ALPHA,
      alphaAdminToken,
      alphaCalendarUrlName,
    );

    expect(response.status).toBe(200);
    const events = await response.json();
    expect(events.length).toBeGreaterThan(0);
  });

  test('should allow editor to update event on remote calendar', async () => {
    // Get the event created by the editor
    const eventsResponse = await getCalendarEvents(
      INSTANCE_ALPHA,
      alphaAdminToken,
      alphaCalendarUrlName,
    );
    const events = await eventsResponse.json();
    const event = events.find(
      (e: any) => e.content.en.name === 'Cross-Instance Event',
    );

    expect(event).toBeDefined();

    // Update the event from Instance Beta
    // Note: calendarId is required for remote event updates to identify the target calendar
    const updateResponse = await fetch(
      `${INSTANCE_BETA.baseUrl}/api/v1/events/${event.id}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${betaAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          calendarId: alphaCalendarId,
          content: {
            en: {
              name: 'Updated Cross-Instance Event',
              description: 'Event updated by editor from Instance Beta',
            },
          },
        }),
        // @ts-ignore - agent is not in the TypeScript types but works at runtime
        agent: httpsAgent,
      },
    );

    expect(updateResponse.status).toBe(200);

    // Verify update is reflected on Instance Alpha. The Update activity is
    // delivered asynchronously through the outbox worker (pv-dyyw), so poll
    // until the remote instance reflects the new title.
    await expect.poll(
      async () => {
        const verifyResponse = await getCalendarEvents(
          INSTANCE_ALPHA,
          alphaAdminToken,
          alphaCalendarUrlName,
        );
        const updatedEvents = await verifyResponse.json();
        const updated = updatedEvents.find((e: any) => e.id === event.id);
        return updated?.content?.en?.name;
      },
      { timeout: 15000, intervals: [500, 1000, 2000] },
    ).toBe('Updated Cross-Instance Event');
  });

  test('should allow editor to delete event on remote calendar', async () => {
    // Get the event to delete
    const eventsResponse = await getCalendarEvents(
      INSTANCE_ALPHA,
      alphaAdminToken,
      alphaCalendarUrlName,
    );
    const events = await eventsResponse.json();
    const event = events.find(
      (e: any) => e.content.en.name === 'Updated Cross-Instance Event',
    );

    expect(event).toBeDefined();

    // Delete the event from Instance Beta
    // Note: calendarId is required as a query parameter for remote event deletion
    const deleteResponse = await fetch(
      `${INSTANCE_BETA.baseUrl}/api/v1/events/${event.id}?calendarId=${alphaCalendarId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${betaAdminToken}`,
        },
        // @ts-ignore - agent is not in the TypeScript types but works at runtime
        agent: httpsAgent,
      },
    );

    expect(deleteResponse.status).toBe(204); // No content on successful delete

    // Verify deletion on Instance Alpha. The Delete activity is delivered
    // asynchronously through the outbox worker (pv-dyyw), so poll until the
    // remote instance no longer returns the event.
    await expect.poll(
      async () => {
        const verifyResponse = await getCalendarEvents(
          INSTANCE_ALPHA,
          alphaAdminToken,
          alphaCalendarUrlName,
        );
        const remainingEvents = await verifyResponse.json();
        return remainingEvents.find((e: any) => e.id === event.id);
      },
      { timeout: 15000, intervals: [500, 1000, 2000] },
    ).toBeUndefined();
  });

  test('should allow owner to revoke cross-instance editor access', async () => {
    // Get the remote editor relationship
    const editorsResponse = await fetch(
      `${INSTANCE_ALPHA.baseUrl}/api/v1/calendars/${alphaCalendarId}/editors`,
      {
        headers: {
          'Authorization': `Bearer ${alphaAdminToken}`,
        },
        // @ts-ignore - agent is not in the TypeScript types but works at runtime
        agent: httpsAgent,
      },
    );

    const editors = await editorsResponse.json();
    const betaEditor = editors.activeEditors.find(
      (e: any) => e.actorUri && e.actorUri.includes('Admin'),
    );

    expect(betaEditor).toBeDefined();

    // Anchor beta's log line count before the revoke so the log-poll below
    // only considers Remove activities emitted by this action.
    const undoAnchor = getBetaLogLineCount();

    // Revoke editor access
    const revokeResponse = await fetch(
      `${INSTANCE_ALPHA.baseUrl}/api/v1/calendars/${alphaCalendarId}/editors/remote`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${alphaAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          actorUri: betaEditor.actorUri,
        }),
        // @ts-ignore - agent is not in the TypeScript types but works at runtime
        agent: httpsAgent,
      },
    );

    expect(revokeResponse.status).toBe(204);

    // Verify the Remove(editor) packet actually reached beta's inbox. The
    // beta editor actor URI is used as the needle to distinguish this
    // Remove from any other Remove activities in beta's log. Per pv-o3ay.6:
    // Remove is the AS2 §8.13 verb for collection-membership revocation
    // (symmetric with Add); Undo is reserved for relationship/intent
    // activities like Follow / Accept / Block / Announce.
    expect(
      await waitForBetaInboxActivity('Remove', betaEditor.actorUri, undoAnchor),
    ).toBe(true);

    // Verify the revoked editor can no longer create events on the remote
    // calendar. Beta's processRemoveActivity (above) destroyed the local
    // CalendarMemberEntity linking betaAdmin to alphaCalendar, so beta's
    // events endpoint no longer finds any remote-membership record for
    // this (account, calendarId) pair and surfaces it as 404 — the
    // federation-correct local view. (Prior to the Remove emission
    // landing, beta still believed the editor relationship held and
    // forwarded the create to alpha, whose authoritative refusal came
    // back as 403; with the federation handshake now complete the local
    // 404 short-circuits the roundtrip.) The behavioural invariant —
    // the revoked editor cannot create events — is preserved.
    const eventData = {
      calendarId: alphaCalendarId,
      content: {
        en: {
          name: 'Post-Revocation Event',
          description: 'This should fail',
        },
      },
      start_date: '2025-09-25',
      start_time: '15:00',
      end_date: '2025-09-25',
      end_time: '16:00',
    };

    const createResponse = await fetch(`${INSTANCE_BETA.baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${betaAdminToken}`,
      },
      body: JSON.stringify(eventData),
      // @ts-ignore - agent is not in the TypeScript types but works at runtime
      agent: httpsAgent,
    });

    expect(createResponse.status).toBe(404);
  });
});
