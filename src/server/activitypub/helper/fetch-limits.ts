/**
 * Response-body byte caps for outbound ActivityPub fetches of actor-shaped
 * documents.
 *
 * Lives in a helper module rather than a service so that both the inbox
 * signature middleware (`helper/http_signature.ts`) and the follow service
 * (`service/members.ts`) can share one number without a helper importing
 * from a service.
 */

/**
 * Response-body byte cap for fetching an actor profile document. An actor
 * document is a few kilobytes of JSON; 1 MiB is generous for a legitimate
 * peer and stops a hostile one forcing an unbounded read and `JSON.parse`.
 *
 * Applied both on the authenticated, user-initiated follow path and on the
 * pre-authentication key fetch that runs for every signed inbox request
 * before the signature has been verified. The same number as
 * `MAX_PAGE_BYTES` in `service/backfill.ts`, which caps every outbound GET
 * the backfill worker makes; that one describes outbox pages, so it stays
 * its own constant.
 */
export const ACTOR_PROFILE_MAX_BYTES = 1_048_576;
