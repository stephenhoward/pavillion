/**
 * Longest value this module will hand back. Every column these values are
 * stored in is a `varchar(2048)` (see `ap_event_object`, `calendar_actor`), and
 * on postgres an over-length write is a hard `22001` error, not a truncation —
 * so the cap has to bound what is *returned*, not what arrived.
 */
export const MAX_EXTERNAL_URL_LENGTH = 2048;

/**
 * Sanitizes an untrusted href value from a federated peer. Returns a parsed
 * http(s) URL string or null for any anomaly (non-string, empty/whitespace,
 * too long, malformed, or non-http(s) scheme).
 *
 * Security-critical: this is the authoritative barrier against malicious peers
 * injecting javascript:, data:, ftp:, or other dangerous URL schemes into
 * stored event data. Shared by the inbound Event and Note object parsers so the
 * scheme allowlist has a single source of truth. NEVER throws — a throw would
 * cause the inbox to reject the entire activity, which is not the correct
 * posture for a single bad field.
 *
 * The length cap is applied **twice, and the second one is the one that
 * matters**: WHATWG normalization percent-encodes, which can expand the input
 * roughly threefold (727 characters of `<` normalize to 2127), so a pre-parse
 * check alone bounds the input and not the value a caller goes on to store.
 * The pre-parse check survives only to reject absurd input cheaply.
 */
export function sanitizeExternalUrlHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > MAX_EXTERNAL_URL_LENGTH) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const normalized = parsed.toString();
    if (normalized.length > MAX_EXTERNAL_URL_LENGTH) return null;
    return normalized;
  }
  catch {
    return null;
  }
}

/**
 * Sanitizes the `url` property of a remote actor document into the peer's
 * public page URL, or null when the peer declared nothing usable.
 *
 * AS2 `url` is polymorphic: a bare string, a `{ type: 'Link', href }` object,
 * or an array of either (Mastodon emits a string; Mobilizon has emitted Link
 * objects). The first candidate that survives sanitization wins and the rest
 * are dropped — there is no "best" URL to choose between.
 *
 * Security-critical. The result is rendered as an `<a href>` on anonymous
 * public event pages and opened in a new tab, so on top of the scheme
 * allowlist it is **host-pinned to the actor URI's host**: a peer may only
 * declare a page URL on its own host. Without the pin, a hostile peer could
 * put an arbitrary link on our page carrying its own handle as the label.
 * Host equality is exact — `URL.host` includes the port and normalizes case,
 * so a subdomain, a lookalike suffix, or a different port is a different host.
 * `URL.host` ignores userinfo, so credentials are rejected separately: a peer
 * may not hand us `https://admin:secret@peer.example/x`, whose visible
 * authority disagrees with the handle we label the link with and which some
 * browsers auto-submit as Basic auth.
 *
 * The rule is restated on the render path in the calendar domain's
 * `parseAttributedToUri`, which cannot import this module across the
 * [DEC-003](../../../../agent-os/product/decisions/dec-003-domain-driven-architecture.md)
 * boundary; this function is the rule of record, and
 * `src/server/activitypub/test/helper/url-sanitizer.test.ts` holds the
 * table-driven test that keeps the two in step on every axis — scheme, host,
 * userinfo, normalization and length. NEVER throws — a single bad field must
 * not fail the follow or the activity that carried it, which is why the actor
 * URI is validated and re-read through the same parse rather than trimmed once
 * and parsed raw: `String.prototype.trim()` strips NBSP, BOM and other
 * characters the WHATWG parser does not, so those two disagree.
 *
 * @param raw - The actor document's `url` property, in any AS2 shape
 * @param actorUri - The actor URI the document was fetched as; pins the host
 * @returns The peer's page URL, or null if nothing usable was declared
 */
export function sanitizePeerPageUrl(raw: unknown, actorUri: string): string | null {
  const sanitizedActorUri = sanitizeExternalUrlHref(actorUri);
  if (!sanitizedActorUri) return null;
  const actorHost = new URL(sanitizedActorUri).host;

  for (const candidate of Array.isArray(raw) ? raw : [raw]) {
    const href = typeof candidate === 'string'
      ? candidate
      : (candidate as { href?: unknown } | null)?.href;
    const sanitized = sanitizeExternalUrlHref(href);
    if (!sanitized) continue;
    const parsed = new URL(sanitized);
    if (parsed.host !== actorHost) continue;
    if (parsed.username || parsed.password) continue;
    return sanitized;
  }

  return null;
}
