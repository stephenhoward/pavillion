/**
 * Signed Outbound Delivery for All Four Signed Activity Types
 *
 * Bead context: pv-dyyw.3.1 -- empirical proof that all four signed
 * deliveries (Create, Update, Delete, Add) from this instance flow through
 * the outbox under HTTP signatures and reach the remote inbox handler.
 *
 * Coverage (one assertion per signed activity type):
 *   - Create(Event)              -> remote calendar inbox
 *   - Update(Event)              -> remote calendar inbox
 *   - Delete(Event) (Tombstone)  -> remote calendar inbox
 *   - Add (editor invite)        -> remote user inbox
 *
 * What this proves (and what it does NOT prove):
 *   Each test triggers a local action that, after Wave 2 of the pv-dyyw epic,
 *   routes through addToOutbox / deliverActivitySigned. The outbox worker
 *   signs the activity (Date, Digest, Signature headers) and POSTs it to the
 *   remote inbox. We assert the side effect of each delivery on the remote
 *   (event in feed, inbox log entry, editor relationship recorded), proving
 *   the OUTBOUND signing + delivery pipeline works end to end.
 *
 *   This spec does NOT, on its own, prove that the receive-side cryptographic
 *   gate would reject a forged or unsigned request: the Docker federation
 *   harness sets SKIP_SIGNATURES=true on both instances, so
 *   verifyHttpSignature short-circuits on the receiver. The cryptographic
 *   round-trip (sign with a real RSA key, then verify with the matching
 *   public key, both with SKIP_SIGNATURES=false) is proven separately by the
 *   unit tests in
 *   `src/server/activitypub/test/helper/http_signature.test.ts`
 *   under describe block "HTTP Signature Cryptographic Round-Trip".
 *
 *   Together, this e2e (outbound pipeline) plus those unit tests
 *   (cryptographic verification) cover the bead's acceptance criteria.
 *
 * Prerequisites:
 *   - Federation environment running: npm run federation:start
 *   - /etc/hosts entries for alpha.federation.local and beta.federation.local
 */

import { test, expect } from '@playwright/test';
import https from 'https';
import { execSync } from 'child_process';
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
  updateEvent,
  deleteEvent,
  followCalendar,
  getFeed,
  grantEditorAccessByEmail,
} from './helpers/api';

// Self-signed cert tolerance for local Docker federation environment
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Poll Beta's feed for an event matching the predicate.
 *
 * Returns the matching event if found within the timeout, otherwise undefined.
 * Polling avoids brittle fixed sleeps when federation latency varies.
 */
async function waitForFeedEvent(
  token: string,
  calendarId: string,
  predicate: (e: { content: Record<string, { title: string }> }) => boolean,
  timeoutMs = 15000,
  intervalMs = 1000,
): Promise<{ id: string; content: Record<string, { title: string }> } | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const feed = await getFeed(INSTANCE_BETA, token, calendarId);
    const match = feed.events.find(predicate);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return undefined;
}

/**
 * Capture the current Beta container log line count so we can later inspect
 * only log entries emitted AFTER an action under test. Without this anchor,
 * a stale entry from a prior run (or a prior test in the same run) could
 * satisfy a substring assertion and produce a false positive.
 */
function getBetaLogLineCount(): number {
  try {
    const out = execSync(
      'docker logs pavillion-federation-beta 2>&1 | wc -l',
      { encoding: 'utf8' },
    );
    return parseInt(out.trim(), 10) || 0;
  }
  catch {
    return 0;
  }
}

/**
 * Poll Beta's container logs (only entries emitted AFTER `sinceLine`) for
 * evidence that an inbox activity of the given type, mentioning the given
 * needle, was processed.
 *
 * The inbox processing pipeline runs only AFTER verifyHttpSignature accepts
 * the request. So any log entry from inbox.ts that mentions the activity
 * type and the needle is positive evidence that signed delivery reached the
 * inbox handler. Downstream business-logic outcomes (accept, reject,
 * ownership failure) are out of scope here -- we are proving that the
 * activity arrived, not that it was semantically valid.
 *
 * Used for Delete(Tombstone) where the side-effect ("event gone from feed")
 * is masked by ownership-verification rules that fetch the now-deleted
 * source object and fail with 404/500, rejecting the activity at a layer
 * far below the inbox handler.
 *
 * @param activityType - ActivityPub activity type to look for (e.g. 'Delete')
 * @param needle - Substring that must appear in the post-anchor log slice
 *                 (typically the event id under test)
 * @param sinceLine - Log line count captured BEFORE the action; only lines
 *                    after this offset are considered
 */
function waitForBetaInboxActivity(
  activityType: string,
  needle: string,
  sinceLine: number,
  timeoutMs = 20000,
  intervalMs = 1000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      try {
        // Slice the log to only entries emitted AFTER the action under test.
        // tail -n +N starts at line N (1-indexed), so sinceLine + 1 yields
        // strictly the new entries.
        const logs = execSync(
          `docker logs pavillion-federation-beta 2>&1 | tail -n +${sinceLine + 1}`,
          { encoding: 'utf8' },
        );
        // The activityType is logged as a structured field; tolerate ANSI
        // color codes around the JSON-ish key by checking substrings.
        if (
          logs.includes(needle)
          && logs.includes('activityType')
          && logs.includes(`"${activityType}"`)
        ) {
          resolve(true);
          return;
        }
      }
      catch { /* container may briefly be unavailable */ }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/**
 * Poll an async action that returns truthy on success. Useful when we need
 * to wait for cross-instance state to settle (e.g. an editor relationship
 * recorded on Beta after a signed Add delivery from Alpha) without resorting
 * to fixed sleeps that flake in CI.
 *
 * Resolves with the truthy result on success or undefined on timeout.
 */
async function pollUntil<T>(
  attempt: () => Promise<T | undefined>,
  timeoutMs = 20000,
  intervalMs = 1000,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await attempt();
      if (result) return result;
    }
    catch { /* keep polling on transient errors */ }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return undefined;
}

test.describe.serial('Signed Delivery for All Four Activity Types', () => {
  let alphaToken: string;
  let betaToken: string;

  let alphaCalendar: { id: string; urlName: string };
  let betaCalendar: { id: string; urlName: string };
  let createdEventId: string;
  const createTitle = `SigDelivery Create ${Date.now()}`;
  const updateTitle = `SigDelivery Update ${Date.now()}`;

  test.beforeAll(async () => {
    alphaToken = await getToken(
      INSTANCE_ALPHA,
      INSTANCE_ALPHA.adminEmail,
      INSTANCE_ALPHA.adminPassword,
    );
    betaToken = await getToken(
      INSTANCE_BETA,
      INSTANCE_BETA.adminEmail,
      INSTANCE_BETA.adminPassword,
    );

    // Fresh calendars on both instances so we don't collide with sibling specs.
    alphaCalendar = await createCalendar(INSTANCE_ALPHA, alphaToken, {
      urlName: generateCalendarName('asd'),
      content: { en: { name: 'Alpha SigDelivery Calendar' } },
    });
    betaCalendar = await createCalendar(INSTANCE_BETA, betaToken, {
      urlName: generateCalendarName('bsd'),
      content: { en: { name: 'Beta SigDelivery Calendar' } },
    });

    // Beta follows Alpha. The Follow itself is a signed activity; the
    // resulting Accept proves the round-trip works. Subsequent Create /
    // Update / Delete event activities from Alpha then flow to Beta's
    // calendar inbox under HTTP signatures.
    const alphaRemoteId = formatRemoteCalendarId(alphaCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, betaToken, betaCalendar.id, alphaRemoteId);

    // Allow Follow/Accept handshake to settle.
    await new Promise(resolve => setTimeout(resolve, 3000));
  });

  test('Create(Event) signed delivery is accepted by remote calendar inbox', async () => {
    // Create an event on Alpha. Outbox worker signs and POSTs Create(Event)
    // to Beta's inbox. If signing or verification failed, the event would
    // never reach Beta's feed.
    const event = await createEvent(INSTANCE_ALPHA, alphaToken, {
      calendarId: alphaCalendar.id,
      content: {
        en: {
          title: createTitle,
          description: 'Signed Create delivery test',
        },
      },
      startTime: '2026-07-01T18:00:00Z',
      endTime: '2026-07-01T20:00:00Z',
    });
    createdEventId = event.id;

    const propagated = await waitForFeedEvent(
      betaToken,
      betaCalendar.id,
      (e) => e.content?.en?.title === createTitle,
    );

    expect(
      propagated,
      'Create(Event) must be visible in remote feed after signed delivery',
    ).toBeDefined();
  });

  test('Update(Event) signed delivery is accepted by remote calendar inbox', async () => {
    // Mutate the previously-created event on Alpha. Outbox emits a signed
    // Update(Event); Beta processes the update and refreshes the title in
    // its feed.
    expect(createdEventId).toBeDefined();
    await updateEvent(INSTANCE_ALPHA, alphaToken, createdEventId, {
      calendarId: alphaCalendar.id,
      content: {
        en: {
          title: updateTitle,
          description: 'Signed Update delivery test',
        },
      },
      startTime: '2026-07-01T18:00:00Z',
      endTime: '2026-07-01T20:00:00Z',
    });

    const updated = await waitForFeedEvent(
      betaToken,
      betaCalendar.id,
      (e) => e.content?.en?.title === updateTitle,
    );

    expect(
      updated,
      'Update(Event) must be reflected in remote feed after signed delivery',
    ).toBeDefined();
  });

  test('Delete(Event) Tombstone signed delivery is accepted by remote calendar inbox', async () => {
    // Delete the event on Alpha. Outbox emits a signed Delete (Tombstone) and
    // POSTs it to Beta's calendar inbox. The signature gate runs first; only
    // if it passes does the inbox handler log "Received inbox activity".
    //
    // We assert delivery acceptance via Beta's container logs rather than via
    // feed observation because Beta's actorOwnsObject check fetches the
    // (now-deleted) event from Alpha and rejects on 404, which would mask a
    // signature success. The presence of "Received inbox activity" with
    // activityType: Delete and the deleted event id proves signed delivery
    // succeeded; the downstream ownership rejection is a separate concern
    // outside this bead's scope.
    expect(createdEventId).toBeDefined();
    const deletedId = createdEventId;

    // Anchor BEFORE the delete so the log assertion cannot match entries
    // from prior runs or earlier tests in this run.
    const logAnchor = getBetaLogLineCount();

    await deleteEvent(INSTANCE_ALPHA, alphaToken, deletedId);

    const delivered = await waitForBetaInboxActivity('Delete', deletedId, logAnchor);

    expect(
      delivered,
      'Delete(Event) Tombstone must reach Beta\'s inbox handler (proves signed delivery reached the inbox)',
    ).toBe(true);
  });

  test('Add editor-invite signed delivery is accepted by remote user inbox', async () => {
    // Trigger an editor invite from Alpha for a Beta user. This produces an
    // Add activity addressed to the Beta user's inbox via addToOutbox with
    // explicit `to`. The outbox worker signs and delivers it. Successful
    // delivery is proven by Beta recording the editor relationship -- which
    // Beta exposes by allowing the invited user to operate on Alpha's
    // calendar.
    const editorEmail = `Admin@${INSTANCE_BETA.domain}`;
    const inviteCalendar = await createCalendar(INSTANCE_ALPHA, alphaToken, {
      urlName: generateCalendarName('asa'),
      content: { en: { name: 'Alpha SigDelivery Add Calendar' } },
    });

    const grantResponse = await grantEditorAccessByEmail(
      INSTANCE_ALPHA,
      alphaToken,
      inviteCalendar.id,
      editorEmail,
    );
    expect(grantResponse.status).toBe(201);

    // Beta-side proof: the invited remote user can now create an event on
    // Alpha's inviteCalendar. This requires that Beta processed the Add
    // activity and recorded the editor relationship -- which only happens
    // if the Add was successfully delivered to and accepted by Beta's user
    // inbox.
    //
    // Federation latency varies, so retry the proof action until it succeeds
    // or we hit the deadline. A fixed sleep (the previous implementation)
    // either over-waits or flakes on slow CI.
    const eventData = {
      calendarId: inviteCalendar.id,
      content: {
        en: {
          name: `SigDelivery Add Event ${Date.now()}`,
          description: 'Created by remote editor after signed Add delivery',
        },
      },
      start_date: '2026-07-15',
      start_time: '14:00',
      end_date: '2026-07-15',
      end_time: '16:00',
    };

    const successfulResponse = await pollUntil(async () => {
      const response = await fetch(`${INSTANCE_BETA.baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${betaToken}`,
        },
        body: JSON.stringify(eventData),
        // @ts-ignore - agent is not in the TypeScript types but works at runtime
        agent: httpsAgent,
      });
      return response.status === 201 ? response : undefined;
    }, 20000, 1000);

    expect(
      successfulResponse,
      'Add editor-invite must be accepted by Beta so the remote editor can act on the invited calendar',
    ).toBeDefined();
  });
});
