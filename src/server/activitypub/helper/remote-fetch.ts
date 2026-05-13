import axios from 'axios';
import { logError } from '@/server/common/helper/error-logger';
import { REMOTE_OBJECT_FETCH_TIMEOUT_MS } from '@/server/common/constants';
import { validateUrlNotPrivate } from '@/server/common/helper/ip-validation';
import { createLogger } from '@/server/common/helper/logger';
import { Calendar } from '@/common/model/calendar';
import CalendarActorService from '@/server/activitypub/service/calendar_actor';
import CalendarInterface from '@/server/calendar/interface';
import { EventEmitter } from 'events';

const logger = createLogger('activitypub');

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
 * @param calendar - The local calendar whose actor keypair signs the request
 */
async function buildSignedGetHeaders(
  uri: string,
  calendar: Calendar,
): Promise<{ Signature: string; Date: string } | null> {
  try {
    // The outbox uses an EventEmitter-wired CalendarInterface; for read-only
    // actor lookup we don't need a live event bus, so a fresh emitter is fine.
    const calendarService = new CalendarInterface(new EventEmitter());
    const calendarActorService = new CalendarActorService(calendarService);

    const actor = await calendarActorService.getActorByCalendarId(calendar.id);
    if (!actor) {
      logger.warn({ calendarId: calendar.id }, 'No calendar actor found for signing GET');
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
 * Optional fetch tuning for {@link fetchRemoteObject}. Currently exposes only
 * a response-body byte cap; additional knobs may be added without breaking
 * existing callers because the parameter itself is optional.
 */
export interface FetchRemoteObjectOptions {
  /**
   * Maximum number of bytes the axios client will accept in the response
   * body. When the response exceeds this size axios aborts and the helper
   * returns null. Defaults to axios's library default (effectively
   * unbounded) when omitted. The AP follow-backfill worker passes a
   * 1 MiB cap to stay within the documented page-size budget.
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
 * When a `signingCalendar` is provided, the outbound GET is HTTP-signed using
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
 * @param uri - The URI of the remote ActivityPub object to fetch
 * @param signingCalendar - Optional local calendar whose actor keypair signs
 *   the outbound GET. When omitted, the request is sent unsigned.
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
 *   followingCalendar,
 *   { maxContentLength: 1_048_576 },
 * );
 * ```
 */
export async function fetchRemoteObject(
  uri: string,
  signingCalendar?: Calendar,
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

    // When a signing calendar is provided, attach HTTP Signature headers. Fail
    // closed on any signing error — see buildSignedGetHeaders docstring.
    if (signingCalendar) {
      const signedHeaders = await buildSignedGetHeaders(uri, signingCalendar);
      if (!signedHeaders) {
        logger.error({ uri, calendarId: signingCalendar.id }, 'Signed GET requested but signing failed');
        return null;
      }
      headers.Signature = signedHeaders.Signature;
      headers.Date = signedHeaders.Date;
    }

    const axiosConfig: Record<string, unknown> = {
      headers,
      timeout: REMOTE_OBJECT_FETCH_TIMEOUT_MS,
      maxRedirects: 0,
    };
    if (options?.maxContentLength !== undefined) {
      axiosConfig.maxContentLength = options.maxContentLength;
      // axios's `maxBodyLength` guards request bodies (irrelevant for GETs)
      // while `maxContentLength` guards response bodies; we set the latter
      // here. Documented for future maintainers who confuse the two.
    }

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
