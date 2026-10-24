/** Widget allowed-domain rule, shared by client and server. */

/** One DNS label: 1–63 characters, no leading or trailing hyphen. */
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';

/**
 * At least two labels, an optional single trailing dot, and an optional port.
 * No scheme, path, space or wildcard can match.
 */
const WIDGET_DOMAIN_RE = new RegExp(`^((?:${LABEL}\\.)+${LABEL}\\.?)(?::(\\d{1,5}))?$`, 'i');

const MAX_HOSTNAME_LENGTH = 253;

/**
 * Whether a value is a well-formed widget allowed domain: "host[:port]".
 *
 * The hostname is at least two labels (an alphabetic TLD is not required, so
 * an IPv4 address passes), at most 253 characters, and may end in one dot;
 * a port, when present, is 1–65535. A value failing this rule is refused on
 * save and treated as unconfigured by the widget shell (DEC-020).
 *
 * @param domain - Candidate domain, without protocol
 * @returns True if the domain is well-formed
 */
export function isValidWidgetDomain(domain: string): boolean {
  if (typeof domain !== 'string') {
    return false;
  }

  const match = WIDGET_DOMAIN_RE.exec(domain);
  if (!match) {
    return false;
  }

  const [, hostname, port] = match;
  if (hostname.length > MAX_HOSTNAME_LENGTH) {
    return false;
  }

  if (port !== undefined) {
    const value = Number(port);
    if (value < 1 || value > 65535) {
      return false;
    }
  }

  return true;
}
