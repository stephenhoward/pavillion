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
 */
export function sanitizeExternalUrlHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > 2048) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
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
 *
 * The rule is restated on the render path in the calendar domain's
 * `parseAttributedToUri`, which cannot import this module across the
 * [DEC-003](../../../../agent-os/product/decisions/dec-003-domain-driven-architecture.md)
 * boundary; this function is the rule of record. NEVER throws — a single bad
 * field must not fail the follow or the activity that carried it.
 *
 * @param raw - The actor document's `url` property, in any AS2 shape
 * @param actorUri - The actor URI the document was fetched as; pins the host
 * @returns The peer's page URL, or null if nothing usable was declared
 */
export function sanitizePeerPageUrl(raw: unknown, actorUri: string): string | null {
  const actorHost = sanitizeExternalUrlHref(actorUri) ? new URL(actorUri).host : null;
  if (!actorHost) return null;

  for (const candidate of Array.isArray(raw) ? raw : [raw]) {
    const href = typeof candidate === 'string'
      ? candidate
      : (candidate as { href?: unknown } | null)?.href;
    const sanitized = sanitizeExternalUrlHref(href);
    if (!sanitized) continue;
    if (new URL(sanitized).host !== actorHost) continue;
    return sanitized;
  }

  return null;
}
