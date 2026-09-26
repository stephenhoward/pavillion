import axios from 'axios';
import { logError } from '@/server/common/helper/error-logger';
import { REMOTE_OBJECT_FETCH_TIMEOUT_MS } from '@/server/common/constants';
import { validateUrlNotPrivate } from '@/server/common/helper/ip-validation';
import { createLogger } from '@/server/common/helper/logger';
import { Calendar } from '@/common/model/calendar';
import CalendarActorService from '@/server/activitypub/service/calendar_actor';
import CalendarInterface from '@/server/calendar/interface';

const logger = createLogger('activitypub');

/**
 * Everything {@link fetchRemoteObject} needs to HTTP-sign an outbound GET on
 * behalf of a local calendar. The caller supplies its own bus-wired
 * `CalendarInterface` rather than letting the signer fabricate one: the actor
 * lookup on the signing path emits nothing today, but bundling the live
 * interface keeps the path attached to the host process's real event bus, so
 * any future emit reaches real subscribers instead of being silently dropped
 * on a throwaway emitter.
 */
export interface SigningContext {
  /** Local calendar whose actor keypair signs the request. */
  calendar: Calendar;
  /** The host process's bus-wired calendar interface, used to read the actor. */
  calendarInterface: CalendarInterface;
}

/**
 * User agent string for ActivityPub federation requests.
 */
const USER_AGENT = 'Pavillion ActivityPub Server';

/**
 * Accept header for ActivityPub requests.
 */
const ACTIVITYPUB_ACCEPT_HEADER = 'application/activity+json';

/**
 * Builds the Signature/Date headers for a signed outbound GET on behalf of
 * the given local calendar. Returns null on any failure (missing actor,
 * missing private key, signing error) so the caller can decide whether to
 * fail closed or fall back to an unsigned request. The current caller
 * (`fetchRemoteObject`) fails closed by returning null when signing was
 * requested but produced no headers — sending an unsigned GET after the
 * caller asked for a signed one would silently degrade federation behavior
 * for Mastodon-style peers that require signed GETs.
 *
 * Kept as a module-private helper rather than exported because the only
 * outbound-signed-GET caller in the codebase is fetchRemoteObject; if a
 * second caller appears, promote this to a shared helper.
 *
 * @param uri - The full target URI being fetched
 * @param signing - The calendar to sign as and the bus-wired interface to
 *   read its actor through
 */
async function buildSignedGetHeaders(
  uri: string,
  signing: SigningContext,
): Promise<{ Signature: string; Date: string } | null> {
  try {
    // Read the actor through the caller's bus-wired CalendarInterface. The
    // lookup and signing methods used here query CalendarActorEntity directly
    // and emit nothing today, but reusing the host's real interface — rather
    // than fabricating one on a throwaway emitter — keeps the signing path on
    // the live event bus if that ever changes.
    const calendarActorService = new CalendarActorService(signing.calendarInterface);

    const actor = await calendarActorService.getActorByCalendarId(signing.calendar.id);
    if (!actor) {
      logger.warn({ calendarId: signing.calendar.id }, 'No calendar actor found for signing GET');
      return null;
    }

    // signActivity returns an HttpSignature with all the pieces; assemble the
    // Signature header string in the same format as POST delivery.
    const sig = await calendarActorService.signActivity(
      actor.actorUri,
      // activity payload is unused for GET signing but the parameter is
      // required by the shared signing primitive; pass an empty object.
      {},
      uri,
      undefined, // no digest — GET has no body
      'get',
    );

    return {
      Signature: `keyId="${sig.keyId}",algorithm="${sig.algorithm}",headers="${sig.headers}",signature="${sig.signature}"`,
      Date: sig.date,
    };
  }
  catch (error) {
    logError(error, `[ActivityPub] Failed to build signed GET headers for ${uri}`);
    return null;
  }
}

/**
 * Default response-body byte cap for a single fetched ActivityPub object
 * (1 MiB), applied whenever a caller omits `maxContentLength`.
 *
 * SECURITY: the fetch is reachable from an inbound `Announce`, whose object
 * URI is peer-controlled and whose fetched body is normalized into an event
 * row and rendered on a public calendar page. Without a default, a caller
 * that omits the option accepts a body of any size, and every new call site
 * would have to remember to pass one. A default makes an omitted option
 * bounded rather than unlimited; the explicit option remains an override.
 *
 * 1 MiB matches the cap already applied to the other outbound GETs
 * (`ACTOR_PROFILE_MAX_BYTES` for actor profiles, `MAX_PAGE_BYTES` for
 * backfill collection pages), so one number governs every peer-facing fetch.
 * It is an order of magnitude above the 100 KiB express.json default that
 * bounds an activity POSTed to the inbox — an embedded Event with several
 * languages of content and a few attachments is a few tens of KiB — while
 * still preventing a hostile peer from streaming an unbounded body into
 * memory.
 */
export const REMOTE_OBJECT_MAX_BYTES = 1_048_576;

/**
 * Optional fetch tuning for {@link fetchRemoteObject}. Currently exposes only
 * a response-body byte cap; additional knobs may be added without breaking
 * existing callers because the parameter itself is optional.
 */
export interface FetchRemoteObjectOptions {
  /**
   * Maximum number of bytes the axios client will accept in the response
   * body. When the response exceeds this size axios aborts and the helper
   * returns null. Defaults to {@link REMOTE_OBJECT_MAX_BYTES} when omitted.
   * Pass a different value when the fetched resource is legitimately a
   * different size from a single object — the AP follow-backfill worker
   * passes its own page-size budget for outbox collection pages.
   */
  maxContentLength?: number;
}

/**
 * Fetches a remote ActivityPub object by URI.
 *
 * This function performs an HTTP GET request to retrieve an ActivityPub object
 * from a remote server. It uses proper headers for ActivityPub content negotiation
 * and handles errors gracefully by returning null on failure.
 *
 * When a `signingContext` is provided, the outbound GET is HTTP-signed using
 * that calendar's actor keypair. This is required by Mastodon 4+ and other AP
 * servers that demand signed GETs on the outbox endpoint; without it those
 * peers silently return zero results. When omitted, behavior is unchanged
 * (unsigned GET) so existing callers continue to work.
 *
 * Signing failure (missing actor, missing private key, etc.) fails closed: if
 * the caller asked for a signed GET and we cannot produce one, we return null
 * rather than silently sending an unsigned request that would be rejected
 * anyway by signature-requiring peers.
 *
 * SECURITY: Validates that the URI does not point to private IP addresses
 * to prevent SSRF (Server-Side Request Forgery) attacks.
 *
 * SECURITY: maxRedirects is set to 0 to prevent redirect-based SSRF attacks
 * where a redirect could lead to a private IP address after the initial URL
 * validation has passed.
 *
 * SECURITY: the response body is always capped — at
 * {@link REMOTE_OBJECT_MAX_BYTES} unless the caller passes its own
 * `maxContentLength` — so a peer-controlled URI cannot stream an unbounded
 * body into memory.
 *
 * @param uri - The URI of the remote ActivityPub object to fetch
 * @param signingContext - Optional calendar + bus-wired interface whose actor
 *   keypair signs the outbound GET. When omitted, the request is sent unsigned.
 * @param options - Optional fetch tuning (currently a response-body byte cap).
 * @returns The parsed JSON object, or null if the fetch fails
 *
 * @example
 * ```typescript
 * // Unsigned (legacy callers)
 * const event = await fetchRemoteObject('https://remote.example/events/123');
 *
 * // Signed (Mastodon-compatible outbox pulls) with a 1 MiB body cap
 * const page = await fetchRemoteObject(
 *   'https://remote.example/users/alice/outbox?page=true',
 *   { calendar: followingCalendar, calendarInterface },
 *   { maxContentLength: 1_048_576 },
 * );
 * ```
 */
export async function fetchRemoteObject(
  uri: string,
  signingContext?: SigningContext,
  options?: FetchRemoteObjectOptions,
): Promise<Record<string, unknown> | null> {
  try {
    // SECURITY: Validate that the URL does not point to a private IP address
    // This prevents SSRF attacks where an attacker could probe internal networks
    try {
      await validateUrlNotPrivate(uri);
    }
    catch (error) {
      if (error instanceof Error) {
        logger.error({ uri, reason: error.message }, 'SSRF block: refused outbound fetch');
      }
      return null;
    }

    const headers: Record<string, string> = {
      'Accept': ACTIVITYPUB_ACCEPT_HEADER,
      'User-Agent': USER_AGENT,
    };

    // When a signing context is provided, attach HTTP Signature headers. Fail
    // closed on any signing error — see buildSignedGetHeaders docstring.
    if (signingContext) {
      const signedHeaders = await buildSignedGetHeaders(uri, signingContext);
      if (!signedHeaders) {
        logger.error({ uri, calendarId: signingContext.calendar.id }, 'Signed GET requested but signing failed');
        return null;
      }
      headers.Signature = signedHeaders.Signature;
      headers.Date = signedHeaders.Date;
    }

    const axiosConfig: Record<string, unknown> = {
      headers,
      timeout: REMOTE_OBJECT_FETCH_TIMEOUT_MS,
      maxRedirects: 0,
      // axios's `maxBodyLength` guards request bodies (irrelevant for GETs)
      // while `maxContentLength` guards response bodies; we set the latter
      // here. Documented for future maintainers who confuse the two.
      maxContentLength: options?.maxContentLength ?? REMOTE_OBJECT_MAX_BYTES,
    };

    const response = await axios.get(uri, axiosConfig);

    if (response.status !== 200) {
      logger.error({ uri, status: response.status }, 'Failed to fetch remote object');
      return null;
    }

    return response.data;
  }
  catch (error) {
    // Log the error but return null to allow graceful handling
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        logError(error, `Timeout fetching remote object from ${uri}`);
      }
      else if (error.response) {
        logError(error, `HTTP error fetching remote object from ${uri}`);
      }
      else if (error.request) {
        logError(error, `Network error fetching remote object from ${uri}`);
      }
      else {
        logError(error, `Error fetching remote object from ${uri}`);
      }
    }
    else {
      logError(error, `Unexpected error fetching remote object from ${uri}`);
    }
    return null;
  }
}
