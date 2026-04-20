import CalendarActorService from "@/server/activitypub/service/calendar_actor";
import UserActorService from "@/server/activitypub/service/user_actor";
import { HttpSignature } from "@/server/activitypub/types";

/**
 * Signed headers returned by buildSignedHeaders, ready to merge into an
 * axios request. When signing fails the helper returns null and the caller
 * records a partial delivery error.
 */
export interface SignedHeaders {
  Signature: string;
  Date: string;
  Digest: string;
}

/**
 * Builds HTTP Signature headers for an outbound ActivityPub delivery.
 * Auto-detects actor type by trying CalendarActorService first, then
 * falling back to UserActorService.
 *
 * The helper itself does NOT compute the digest — the caller is responsible
 * for JSON.stringify-ing the activity once and passing both the resulting
 * `body` (used for actor signing context) and pre-computed `digest` so that
 * the same string is used for the SHA-256 digest header and the HTTP body.
 *
 * @param actorUri - The actor URI that will sign the request
 * @param body - The JSON-stringified request body (parsed once for signActivity)
 * @param targetUrl - The inbox URL the request will be POSTed to
 * @param digest - Pre-computed SHA-256 Digest header value
 * @param calendarActorService - Service used to attempt calendar-actor signing first
 * @param userActorService - Service used as fallback when calendar-actor signing fails
 * @returns Signed headers object, or null if signing fails for both actor types
 */
export async function buildSignedHeaders(
  actorUri: string,
  body: string,
  targetUrl: string,
  digest: string,
  calendarActorService: CalendarActorService,
  userActorService: UserActorService,
): Promise<SignedHeaders | null> {
  let sig: HttpSignature | null = null;

  // Parse the body once and reuse for both signing attempts to avoid redundant
  // JSON.parse work on the fallback path.
  const activity = JSON.parse(body);

  // Try calendar actor first (most common case for outbox deliveries)
  try {
    sig = await calendarActorService.signActivity(actorUri, activity, targetUrl, digest);
  }
  catch {
    // Calendar actor signing failed, try user actor
    try {
      sig = await userActorService.signActivity(actorUri, activity, targetUrl, digest);
    }
    catch {
      // Both actor types failed to sign
      return null;
    }
  }

  if (!sig) {
    return null;
  }

  return {
    Signature: `keyId="${sig.keyId}",algorithm="${sig.algorithm}",headers="${sig.headers}",signature="${sig.signature}"`,
    Date: sig.date,
    Digest: digest,
  };
}
