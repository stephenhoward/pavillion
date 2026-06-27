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
