import { validateApActorUri } from '@/server/notifications/service/ap-actor-uri';

/**
 * Flag actor anonymization policy.
 *
 * This module implements the per-verb policy hook that the notifications
 * service applies to the actor fields of a `Flag` activity row *before*
 * insert: reporter identity never lives in `notification_activity` at all
 * (it stays exclusively on `ReportEntity` in the moderation domain, gated
 * by report admin ACL).
 *
 * Three input shapes, three outputs:
 *
 *   | input kind        | actor_kind  | actor_display_name                | actor_display_url        |
 *   |-------------------|-------------|------------------------------------|--------------------------|
 *   | account           | anonymous   | i18n:flag_actor_anonymous          | null                     |
 *   | remote_actor      | anonymous   | i18n:flag_actor_remote{host:...}   | https://<host>           |
 *   | anonymous_web     | anonymous   | i18n:flag_actor_anonymous          | null                     |
 *
 * Invariants enforced on every output:
 *  - `actor_kind === 'anonymous'`
 *  - `actor_account_id === null`
 *  - `actor_uri === null`
 *
 * The `actor_display_url` is the only field that distinguishes a fully
 * anonymous Flag (local account or web form) from a remote-instance Flag.
 * Clients render the URL's presence/absence as "show instance link or not."
 *
 * ## i18n token format
 *
 * Display names for Flag actors are stored as i18n *tokens*, not localized
 * literals, because the recipient's locale is not known at insert time
 * (a single Flag activity fans out to multiple recipients who may have
 * different locales). Tokens are resolved at render time by the API
 * serialization layer.
 *
 * Token grammar:
 *   - `i18n:flag_actor_anonymous` — parameterless token
 *   - `i18n:flag_actor_remote{host:example.org}` — token with a single host param
 *
 * The host param is always a normalized hostname (NFKC-lowercased, no IP
 * literal, no userinfo) returned by `validateApActorUri`. Because
 * hostnames cannot contain `{`, `}`, `:`, or `,`, the bare key-value form
 * parses unambiguously. If future tokens need richer params, this format
 * can be tightened (e.g., switched to JSON) without changing stored data
 * for existing rows because the i18n: prefix gives a stable parse hook.
 *
 * This choice resolves the "localized anonymized display strings" open
 * question in the) tokens, not (b)
 * inserter-locale snapshots. The render-time resolver hook lives outside
 * this module (it's part of the API serialization layer, added when the
 * verb dispatch is wired up).
 */

/**
 * Canonical i18n token for fully-anonymous Flag actors (local account
 * reports, anonymous web-form reports, and any remote_actor with an
 * unusable URI).
 */
const ANONYMOUS_TOKEN = 'i18n:flag_actor_anonymous';

/**
 * Constructs the per-host i18n token for a remote-instance Flag actor.
 *
 * @param {string} host - Normalized hostname from `validateApActorUri`
 * @returns {string} Token of the form `i18n:flag_actor_remote{host:<host>}`
 */
function remoteToken(host: string): string {
  return `i18n:flag_actor_remote{host:${host}}`;
}

/**
 * Shape of the input passed to `anonymizeFlagActor`. Mirrors the three
 * code paths that produce a Flag (local-account, federated AP actor,
 * anonymous web-form).
 */
export type FlagActorInput =
  | { kind: 'account'; accountId: string }
  | { kind: 'remote_actor'; uri: string }
  | { kind: 'anonymous_web' };

/**
 * Shape of the stored actor fields after anonymization. These map 1:1
 * onto columns on `notification_activity` ().
 */
export interface AnonymizedFlagActor {
  actor_kind: 'anonymous';
  actor_account_id: null;
  actor_uri: null;
  actor_display_name: string;
  actor_display_url: string | null;
}

/**
 * Applies the Flag actor anonymization policy to a reporter input and
 * returns the actor fields to be stored on the notification_activity row.
 *
 * See module docstring for the full rule table.
 *
 * @param {FlagActorInput} input - The reporter's true identity (local
 *   account, remote AP actor, or anonymous web form)
 * @returns {AnonymizedFlagActor} The actor fields to store. Identity
 *   fields are always null; kind is always 'anonymous'.
 */
export function anonymizeFlagActor(input: FlagActorInput): AnonymizedFlagActor {
  const base = {
    actor_kind: 'anonymous' as const,
    actor_account_id: null,
    actor_uri: null,
  };

  if (input.kind === 'remote_actor') {
    const validation = validateApActorUri(input.uri);
    if (validation.kind === 'valid') {
      return {
        ...base,
        actor_display_name: remoteToken(validation.host),
        actor_display_url: `https://${validation.host}`,
      };
    }
    // Fall through to the fully-anonymous form: a malformed or unsafe
    // remote URI is presentationally indistinguishable from a local-account
    // or web-form report. The original URI is never stored on the
    // notification row regardless of validity.
  }

  return {
    ...base,
    actor_display_name: ANONYMOUS_TOKEN,
    actor_display_url: null,
  };
}
