/**
 * Join -> Ignore Federation (FEP-8a8e)
 *
 * Bead context: pv-o3ay.10 -- empirical proof that an inbound `Join` from a
 * peer that models event attendance (Mobilizon, Gancio) is admitted by a
 * Pavillion calendar inbox, dispatched, and answered over the wire with an
 * `Ignore` addressed privately back to the sender.
 *
 * Why an Ignore at all:
 *   Pavillion emits every Event with `joinMode: 'none'` and keeps no
 *   attendance/RSVP state (DEC-004), so a Join is never actionable. FEP-8a8e
 *   requires a server that does not handle a Join to reply with an Ignore
 *   rather than dropping it. `ProcessInboxService.processJoinActivity` mutates
 *   nothing -- it only queues that reply.
 *
 * Why this needs to be an e2e:
 *   Pavillion has no UI or API that originates a Join, so the inbound half can
 *   only be driven by hand-posting the activity to the S2S inbox
 *   (`postActivityToInbox`). And the outbound half crosses the whole stack:
 *   dispatch -> outbox -> `resolveInboxUrl` on a bare actor URI -> signed HTTP
 *   POST -> beta's inbox validation switch -> beta's dispatch. Unit tests cover
 *   the Ignore's construction; nothing below that is exercised anywhere else.
 *
 * Round trip under test:
 *   1. beta owns a calendar whose actor URI is the Join's `actor`, so the
 *      Ignore has a real, resolvable inbox to be delivered to. No follow
 *      relationship is set up: `Join` and `Ignore` are absent from
 *      `FILTERED_TYPES`, so neither needs one, and requiring one here would
 *      quietly overstate what the receiving path demands.
 *   2. alpha owns a calendar with one public event -- the thing being joined.
 *   3. beta POSTs a `Join` naming that event to alpha's calendar inbox.
 *   4. alpha admits it, dispatches it, and queues an `Ignore` embedding the
 *      original Join, addressed to the Join's actor only.
 *   5. beta's calendar inbox admits the `Ignore` (pv-o3ay.12 added it to the
 *      validation switch) and dispatch records it as a deliberate no-op --
 *      `case 'Ignore'` in `dispatchByType`, which logs and breaks. That branch
 *      is expected behaviour, not a gap: an Ignore is informational, and the
 *      persisted `ap_inbox` row IS the outcome.
 *
 * What proves what, and which assertion is load-bearing:
 *
 *   The log poll on alpha proves the Join was ADMITTED. On the calendar's async
 *   path `logInboxActivityAccepted` fires as soon as the `ap_inbox` row is
 *   written -- before dispatch runs (pv-gbqu) -- so on its own it cannot
 *   distinguish "acted on" from "queued and forgotten".
 *
 *   The LOAD-BEARING assertion is the returned Ignore, checked two ways.
 *   Because the Ignore exists only if alpha's dispatcher actually ran
 *   `processJoinActivity`, its arrival at beta is positive evidence that the
 *   Join was dispatched -- the thing the alpha-side log record cannot show. Its
 *   stored `ap_inbox` row on beta then supplies the two facts no log line
 *   carries: the delivered addressing (`to`, and the absence of `as:Public`)
 *   and `processed_status`. A `processed_status` of `'ok'` is what separates
 *   "dispatched and deliberately no-opped" from "written to the inbox and
 *   never dispatched" (`null`) or "dispatch did not recognise the type"
 *   (`'error'`, what the `default: throw` in `dispatchByType` produces).
 *
 *   Only then is the negative assertion meaningful: alpha's participant-facing
 *   event listing is byte-identical before and after. Asserting absence alone
 *   would not distinguish a correct no-op from an activity that never arrived;
 *   paired with the round trip above, it does. Framing note -- Pavillion has no
 *   attendance model for a Join to write to, so this guards against future
 *   drift (someone wiring a Join into event state) rather than a present risk.
 *
 * Signatures are out of scope: both instances run with `SKIP_SIGNATURES=true`
 * (docker-compose.federation.yml), so the hand-built Join is unsigned.
 * Enforcement has its own coverage in `signature_strict_receive.spec.ts`.
 *
 * Prerequisites:
 *   - Federation environment running: npm run federation:start
 *   - /etc/hosts entries for alpha.federation.local and beta.federation.local
 */

import { randomUUID } from 'crypto';
import { test, expect } from '@playwright/test';
import {
  INSTANCE_ALPHA,
  INSTANCE_BETA,
  formatActorUrl,
  generateCalendarName,
  getAlphaLogLineCount,
  getBetaLogLineCount,
  readBetaInboxRowForObject,
  waitForAlphaInboxActivity,
  waitForBetaInboxActivity,
} from './helpers/instances';
import type { InboxRow } from './helpers/instances';
import {
  getToken,
  createCalendar,
  createEvent,
  getPublicCalendarEvents,
  postActivityToInbox,
} from './helpers/api';

/**
 * The magic collection that makes an activity public. An Ignore carrying this
 * in any addressing field would put a private courtesy reply -- and with it the
 * fact that a specific remote actor tried to RSVP -- on the public timeline.
 */
const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';

/**
 * Every addressing field AS2 defines — `as:Public` in any of them makes the
 * activity just as public as it would be in `to`.
 *
 * Read the KNOWN LIMITATION note at the assertion site before trusting this
 * list: against beta's stored row only `to` is actually verified, because
 * `IgnoreActivity.fromObject` copies `to` alone and the receiving model has no
 * `bto`/`bcc`/`audience` fields to hold the rest. Tracked as pv-uwou.
 */
const ADDRESSING_FIELDS = ['to', 'cc', 'bto', 'bcc', 'audience'] as const;

/**
 * Fetch alpha's public event listing for a calendar as a stable string.
 *
 * This is the participant-facing surface -- the unauthenticated
 * `event_instance`-backed list an attendee would see. Serialising it lets the
 * before/after comparison be exact rather than a spot-check of fields someone
 * remembered to assert.
 */
async function readPublicEventListing(calendarUrlName: string): Promise<string> {
  const response = await getPublicCalendarEvents(INSTANCE_ALPHA, calendarUrlName);
  expect(response.ok, 'alpha must serve the public event listing').toBe(true);
  return JSON.stringify(await response.json());
}

/**
 * Poll beta's `ap_inbox` for the Ignore answering `joinActivityId`, until
 * dispatch has recorded an outcome on it.
 *
 * Waits for a non-null `processed_status` specifically: the row is written
 * before dispatch runs, so returning as soon as the row exists would race the
 * very field the caller is there to assert.
 */
async function waitForDispatchedIgnoreRow(
  joinActivityId: string,
  timeoutMs = 20000,
): Promise<InboxRow> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const row = readBetaInboxRowForObject('Ignore', joinActivityId);
    if (row && row.processedStatus !== null) {
      return row;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        row
          ? `Beta stored the Ignore for Join ${joinActivityId} but dispatch never recorded an outcome within ${timeoutMs}ms`
          : `Beta never stored an Ignore answering Join ${joinActivityId} within ${timeoutMs}ms`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

test.describe.serial('Join/Ignore federation', () => {
  test('alpha answers an inbound Join with an Ignore addressed to the sender alone', async () => {
    // ---- Fixture ----
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
      urlName: generateCalendarName('aj'),
      content: { en: { name: 'Alpha Join Federation Calendar' } },
    });

    // Beta's calendar is the Join's actor. It exists so the Ignore has a
    // resolvable delivery target: alpha's outbox resolves the reply's
    // recipient by fetching this actor document and reading its `inbox`.
    const betaCalendar = await createCalendar(INSTANCE_BETA, betaToken, {
      urlName: generateCalendarName('bj'),
      content: { en: { name: 'Beta Join Federation Calendar' } },
    });
    const betaActorUri = formatActorUrl(betaCalendar.urlName, INSTANCE_BETA);

    const alphaEvent = await createEvent(INSTANCE_ALPHA, alphaToken, {
      calendarId: alphaCalendar.id,
      content: {
        en: {
          title: `Join Federation Target ${Date.now()}`,
          description: 'Event a remote peer will attempt to Join',
        },
      },
      startTime: '2026-09-14T18:00:00Z',
      endTime: '2026-09-14T20:00:00Z',
    });
    const alphaEventIri
      = `${INSTANCE_ALPHA.baseUrl}/calendars/${alphaCalendar.urlName}/events/${alphaEvent.id}`;

    // Baseline of the participant-facing surface, captured after the event is
    // published so the comparison is against a non-empty listing.
    const listingBefore = await readPublicEventListing(alphaCalendar.urlName);
    expect(
      listingBefore,
      'the baseline listing must contain the event, or the before/after comparison proves nothing',
    ).toContain(alphaEvent.id);

    // ---- Action: beta posts a Join to alpha's calendar inbox ----
    // Id shape mirrors what JoinActivity mints (`{actor}/joins/{uuid}`), and
    // the fresh uuid is what makes every assertion below discriminating: it
    // appears in alpha's acceptance record, and again inside the Ignore that
    // embeds this Join.
    const joinActivityId = `${betaActorUri}/joins/${randomUUID()}`;
    const joinActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      'id': joinActivityId,
      'type': 'Join',
      'actor': betaActorUri,
      'object': alphaEventIri,
    };

    // Anchored BEFORE the POST so neither log assertion can match a record
    // emitted by an earlier test or an earlier run.
    const alphaAnchor = getAlphaLogLineCount();
    const betaAnchor = getBetaLogLineCount();

    const postResponse = await postActivityToInbox(
      INSTANCE_ALPHA,
      alphaCalendar.urlName,
      joinActivity,
    );
    expect(
      postResponse.status,
      'alpha\'s inbox must accept the Join, not reject it at the validation switch',
    ).toBe(200);

    // ---- Wire, inbound: alpha ADMITTED the Join ----
    // Acceptance, not arrival: the arrival line is emitted before validation,
    // so an activity alpha rejected with 400 would satisfy an arrival-based
    // assertion. This proves admission only -- see the header note.
    const joinAccepted = await waitForAlphaInboxActivity('Join', joinActivityId, alphaAnchor);
    expect(
      joinAccepted,
      'alpha\'s calendar inbox must accept the Join',
    ).toBe(true);

    // ---- Wire, outbound (LOAD-BEARING): the Ignore comes back ----
    // The Ignore is minted by processJoinActivity and by nothing else, so its
    // acceptance on beta is what proves alpha DISPATCHED the Join rather than
    // merely queuing it. Keyed on the Join's id, which the Ignore carries as
    // its embedded object -- the Ignore's own id is minted on alpha and is not
    // knowable here.
    const ignoreAccepted = await waitForBetaInboxActivity('Ignore', joinActivityId, betaAnchor);
    expect(
      ignoreAccepted,
      'beta\'s calendar inbox must accept the Ignore alpha sent back',
    ).toBe(true);

    // ---- Receive side (LOAD-BEARING): the stored row ----
    const ignoreRow = await waitForDispatchedIgnoreRow(joinActivityId);

    expect(
      ignoreRow.processedStatus,
      'dispatch must record the Ignore as a completed no-op; \'error\' would mean dispatchByType did not recognise the type, null that it never ran',
    ).toBe('ok');

    // Addressing: the sender alone. Read off the stored row because no log
    // line carries the delivered recipients.
    expect(
      ignoreRow.message.to,
      'the Ignore must be addressed to the Join\'s actor and no one else',
    ).toEqual([betaActorUri]);

    // KNOWN LIMITATION — only the `to` assertion above is load-bearing.
    //
    // The loop below is future-drift protection, NOT active verification. It
    // reads beta's *stored* row, and beta parses an inbound Ignore through
    // `IgnoreActivity.fromObject`, which copies only `to`. `cc` is left at the
    // base-class default `[]`, and `bto`/`bcc`/`audience` are not fields on
    // `ActivityPubActivity` at all. So these four checks are structurally
    // unable to fail regardless of what alpha actually put on the wire.
    //
    // Concretely: if a regression made `processJoinActivity` address the reply
    // publicly via `cc`, alpha's `toObject()` WOULD emit `cc: [as:Public]` on
    // the wire, and every assertion here would still pass. Proving that needs
    // the raw body alpha transmits, not beta's re-parsed row. Tracked as
    // pv-uwou.
    //
    // Kept because it costs nothing and would catch a future change that gives
    // the receiving model real `cc`/`bto`/`bcc`/`audience` fields.
    for (const field of ADDRESSING_FIELDS) {
      const recipients = ignoreRow.message[field];
      const values = Array.isArray(recipients)
        ? recipients
        : (recipients === undefined || recipients === null ? [] : [recipients]);
      expect(
        values,
        `an Ignore is a private courtesy reply; ${field} must never carry as:Public`,
      ).not.toContain(AS_PUBLIC);
    }

    // The embedded Join is what lets the sender correlate the reply, so assert
    // it survived the round trip rather than trusting the id match alone.
    expect(
      ignoreRow.message.object?.type,
      'the Ignore must embed the activity it answers',
    ).toBe('Join');
    expect(
      ignoreRow.message.object?.id,
      'the embedded Join must be the one beta sent',
    ).toBe(joinActivityId);
    expect(
      ignoreRow.message.actor,
      'the Ignore must be attributed to the alpha calendar that received the Join',
    ).toBe(formatActorUrl(alphaCalendar.urlName, INSTANCE_ALPHA));

    // ---- Negative: no state change on alpha ----
    // Meaningful only because the round trip above proves the Join was
    // actually dispatched. Pavillion has no attendance model for a Join to
    // write to, so this is drift protection against a future change that wires
    // one in -- not a present risk being guarded.
    const listingAfter = await readPublicEventListing(alphaCalendar.urlName);
    expect(
      listingAfter,
      'a dispatched Join must leave the participant-facing event listing byte-identical',
    ).toBe(listingBefore);
  });
});
