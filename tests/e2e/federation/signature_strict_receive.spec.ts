/**
 * Strict-Receive HTTP Signature Verification
 *
 * Bead context: pv-3xit -- proves receive-side cryptographic verification of
 * inbound ActivityPub HTTP signatures across the real Docker / nginx
 * federation harness. The companion spec
 * `tests/e2e/federation/signed_delivery.spec.ts` proves the outbound signing
 * pipeline produces a syntactically valid signed POST. This spec proves the
 * inbound side actually validates the cryptography end-to-end.
 *
 * Why a separate spec:
 *   The federation harness sets SKIP_SIGNATURES=true on both instances by
 *   default so unrelated federation specs do not pay a per-request signature
 *   cost and do not need to chase signing regressions to make calendar
 *   federation work. This spec flips SKIP_SIGNATURES=false on beta only for
 *   the duration of its tests by recreating the beta container with an env
 *   override, and restores the default afterwards. See
 *   tests/e2e/federation/helpers/strict_receive.ts for details on why a
 *   container recreate is required (the Node process reads process.env on
 *   every request and docker exec cannot mutate the parent process's env).
 *
 * Coverage:
 *   - Positive: a signed Create(Event) from alpha is cryptographically
 *     verified by beta (SKIP_SIGNATURES=false) and the event propagates to
 *     beta's follower feed.
 *   - Negative (missing signature): a raw POST to beta's calendar inbox with
 *     no Signature header is rejected with 400 (the http-signature library
 *     throws MissingHeaderError, which the middleware maps to 400 Bad Request
 *     -- see src/server/activitypub/helper/http_signature.ts:167-170).
 *   - Negative (forged signature): a raw POST to beta's calendar inbox with
 *     a syntactically valid but cryptographically invalid Signature header is
 *     rejected with 401 (signature parses, then fails cryptographic
 *     verification).
 *
 * In both negative cases, "rejected" means the inbox refuses to process the
 * activity before any business logic runs. The exact status code differs by
 * branch: 400 for missing-header (parse never starts), 401 for
 * invalid-signature (parse succeeds, verification fails). Both prove the
 * signature gate works.
 *
 * What this proves (and what it does NOT prove):
 *   The positive case proves the full cross-container path -- alpha signs
 *   with its real RSA key, nginx terminates TLS and forwards the request,
 *   beta fetches alpha's public key, beta verifies the digest and signature.
 *   The negative cases lock in the contract that the signature gate
 *   short-circuits with 401 before any inbox business logic runs. They do
 *   not exhaustively cover every possible forgery; deeper unit-level
 *   coverage lives in
 *   `src/server/activitypub/test/helper/http_signature.test.ts`.
 *
 * Prerequisites:
 *   - Federation environment running: npm run federation:start
 *   - /etc/hosts entries for alpha.federation.local and beta.federation.local
 *   - Docker CLI available on PATH (the helper recreates the beta container).
 */

import { test, expect } from '@playwright/test';
import https from 'https';
import crypto from 'crypto';
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
} from './helpers/api';
import {
  setBetaSkipSignatures,
  restoreBetaDefaultSignatures,
} from './helpers/strict_receive';

// Self-signed cert tolerance for local Docker federation environment
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Poll Beta's feed for an event matching the predicate. Polling avoids
 * brittle fixed sleeps when federation latency varies. Returns the matching
 * event or undefined on timeout.
 */
async function waitForFeedEvent(
  token: string,
  calendarId: string,
  predicate: (e: { content: Record<string, { title: string }> }) => boolean,
  timeoutMs = 30000,
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
 * Build a minimal Create(Note) activity body suitable for posting to a
 * calendar inbox. The exact shape is not load-bearing for the negative tests
 * because verifyHttpSignature short-circuits before req.body is processed --
 * what matters is that the request is well-formed enough to reach the
 * signature middleware.
 */
function buildPlaceholderActivity(actorUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Create',
    actor: actorUrl,
    object: {
      type: 'Note',
      content: 'strict-receive negative case probe',
    },
  };
}

test.describe.serial('Strict-Receive HTTP Signature Verification', () => {
  let alphaToken: string;
  let betaToken: string;
  let alphaCalendar: { id: string; urlName: string };
  let betaCalendar: { id: string; urlName: string };

  test.beforeAll(async () => {
    // The beta container recreate can take 30-60s on slow machines, plus
    // calendar/follow setup. The hook itself needs a generous timeout via
    // the option below; test.setTimeout() here extends the per-test timeout
    // for tests in this describe block (which is also useful because the
    // positive case waits for federation propagation under fresh-container
    // state).
    test.setTimeout(180000);

    // Flip beta into strict-receive mode BEFORE creating tokens or calendars,
    // because token acquisition and calendar creation talk to beta and need
    // beta to be up.
    await setBetaSkipSignatures('false');

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

    // Fresh calendars to avoid collisions with sibling specs.
    alphaCalendar = await createCalendar(INSTANCE_ALPHA, alphaToken, {
      urlName: generateCalendarName('asr'),
      content: { en: { name: 'Alpha StrictReceive Calendar' } },
    });
    betaCalendar = await createCalendar(INSTANCE_BETA, betaToken, {
      urlName: generateCalendarName('bsr'),
      content: { en: { name: 'Beta StrictReceive Calendar' } },
    });

    // Beta follows alpha. The Follow itself is signed and -- crucially with
    // SKIP_SIGNATURES=false on beta -- the Accept that comes back from alpha
    // must also pass beta's signature gate. If this succeeds, the round-trip
    // is already partially proven; the positive Create(Event) test below
    // closes the loop with explicit event propagation.
    const alphaRemoteId = formatRemoteCalendarId(alphaCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, betaToken, betaCalendar.id, alphaRemoteId);

    // Allow the Follow/Accept handshake to settle before continuing.
    await new Promise(resolve => setTimeout(resolve, 3000));
  }, { timeout: 180000 });

  test.afterAll(async () => {
    // Always restore the default SKIP_SIGNATURES=true on beta so other
    // federation specs in the same run (or a later run) are unaffected.
    await restoreBetaDefaultSignatures();
  }, { timeout: 180000 });

  test('signed Create(Event) from alpha is cryptographically verified by beta', async () => {
    // With SKIP_SIGNATURES=false on beta, this only succeeds if alpha's
    // signed POST passes beta's verifyHttpSignature middleware -- meaning
    // the real RSA signing + public key fetch + signature verification
    // round-trip works end-to-end across the Docker/nginx path.
    const title = `StrictReceive Create ${Date.now()}`;
    await createEvent(INSTANCE_ALPHA, alphaToken, {
      calendarId: alphaCalendar.id,
      content: {
        en: {
          title,
          description: 'Strict-receive cryptographic verification probe',
        },
      },
      startTime: '2026-08-01T18:00:00Z',
      endTime: '2026-08-01T20:00:00Z',
    });

    const propagated = await waitForFeedEvent(
      betaToken,
      betaCalendar.id,
      (e) => e.content?.en?.title === title,
    );

    expect(
      propagated,
      'Signed Create(Event) must propagate to beta\'s feed under SKIP_SIGNATURES=false (proves receive-side cryptographic verification)',
    ).toBeDefined();
  });

  test('unsigned POST to beta inbox is rejected with 400 (missing signature header)', async () => {
    // No Signature header, no Digest header. The http-signature library
    // throws MissingHeaderError, which the middleware's catch block maps to
    // 400 Bad Request (http_signature.ts:167-170). This is distinct from the
    // forged-signature path (next test) which returns 401 because the
    // signature parses but fails cryptographic verification. Both branches
    // prove the gate refuses to process the activity.
    const inboxUrl = `${INSTANCE_BETA.baseUrl}/calendars/${betaCalendar.urlName}/inbox`;
    const body = buildPlaceholderActivity(
      `${INSTANCE_ALPHA.baseUrl}/calendars/${alphaCalendar.urlName}`,
    );

    const response = await fetch(inboxUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/activity+json',
        Host: INSTANCE_BETA.domain,
        Date: new Date().toUTCString(),
      },
      body: JSON.stringify(body),
      // @ts-ignore - agent is not in the TypeScript types but works at runtime
      agent: httpsAgent,
    });

    expect(
      response.status,
      'Unsigned POST to calendar inbox must be rejected with 400 by the signature gate (MissingHeaderError -> 400; the forged-signature path returns 401)',
    ).toBe(400);
  });

  test('forged Signature header to beta inbox is rejected with 401', async () => {
    // A syntactically valid Signature header but with garbage signature bytes
    // and a keyId that points back at alpha's actor. verifyHttpSignature must
    // fetch the public key and then reject when httpSignature.verifySignature
    // returns false.
    const inboxUrl = `${INSTANCE_BETA.baseUrl}/calendars/${betaCalendar.urlName}/inbox`;
    const actorUrl = `${INSTANCE_ALPHA.baseUrl}/calendars/${alphaCalendar.urlName}`;
    const keyId = `${actorUrl}#main-key`;
    const body = buildPlaceholderActivity(actorUrl);
    const bodyText = JSON.stringify(body);

    // Cryptographically invalid signature bytes (base64 of a fixed string).
    // The middleware verifies the digest BEFORE the signature; we compute a
    // valid SHA-256 digest so the rejection definitively comes from the
    // signature verification step rather than the digest check (both return
    // 401, but this keeps the failure mode aligned with the test name).
    const forgedSignature = Buffer.from('forged-signature-bytes-not-rsa').toString('base64');
    const digest = `SHA-256=${crypto.createHash('sha256').update(bodyText).digest('base64')}`;

    const response = await fetch(inboxUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/activity+json',
        Host: INSTANCE_BETA.domain,
        Date: new Date().toUTCString(),
        Signature: [
          `keyId="${keyId}"`,
          'algorithm="rsa-sha256"',
          'headers="(request-target) host date digest"',
          `signature="${forgedSignature}"`,
        ].join(','),
        Digest: digest,
      },
      body: bodyText,
      // @ts-ignore - agent is not in the TypeScript types but works at runtime
      agent: httpsAgent,
    });

    expect(
      response.status,
      'Forged Signature header must be rejected with 401 (invalid digest or invalid signature)',
    ).toBe(401);
  });
});
