/**
 * Splits plain text into text and link segments so a UI can render real
 * anchors without ever passing the text through an HTML parser.
 *
 * Only explicit http:// and https:// URLs are linked. Anything else
 * (bare domains, emails, other schemes, URLs carrying credentials) stays text.
 */

export interface LinkifySegment {
  type: 'text' | 'link';
  text: string;
  href?: string;
}

const URL_RUN = /https?:\/\/[^\s<>"]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?]$/;

const CLOSERS: Record<string, string> = { ')': '(', ']': '[' };

/**
 * Removes trailing sentence punctuation and closing brackets that have
 * no matching opener inside the URL.
 */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    if (TRAILING_PUNCTUATION.test(url)) {
      url = url.slice(0, -1);
      continue;
    }
    const last = url.charAt(url.length - 1);
    const opener = CLOSERS[last];
    if (opener) {
      const opens = url.split(opener).length - 1;
      const closes = url.split(last).length - 1;
      if (closes > opens) {
        url = url.slice(0, -1);
        continue;
      }
    }
    return url;
  }
}

function toSafeHref(candidate: string): string | null {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  }
  catch {
    return null;
  }
}

export function linkifyText(text: string): LinkifySegment[] {
  const segments: LinkifySegment[] = [];
  if (!text) return segments;

  let cursor = 0;
  let pending = '';

  for (const match of text.matchAll(URL_RUN)) {
    const start = match.index ?? 0;
    const candidate = trimUrl(match[0]);
    const href = toSafeHref(candidate);
    if (!href) continue;

    pending += text.slice(cursor, start);
    if (pending) {
      segments.push({ type: 'text', text: pending });
      pending = '';
    }
    segments.push({ type: 'link', text: candidate, href });
    cursor = start + candidate.length;
  }

  pending += text.slice(cursor);
  if (pending) segments.push({ type: 'text', text: pending });
  return segments;
}
