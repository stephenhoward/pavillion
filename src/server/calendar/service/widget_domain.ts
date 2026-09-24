import { Calendar } from '@/common/model/calendar';
import { CalendarNotFoundError, InvalidDomainFormatError } from '@/common/exceptions/calendar';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import type CalendarService from './calendar';

/**
 * How long a calendar's widget-shell frame-ancestors policy is served from
 * memory before the calendar is looked up again. Bounds the per-load database
 * cost of the public, unauthenticated /widget/* shell. A domain change made
 * through this service invalidates its own entry at once; another process
 * serving the same instance picks the change up within this window.
 */
export const FRAME_ANCESTORS_CACHE_TTL_MS = 60_000;

/**
 * Cap on cached policies. The shell answers any well-formed calendar name,
 * so unknown names are cached too; the cap keeps a scan of made-up names from
 * growing the map without bound.
 */
const FRAME_ANCESTORS_CACHE_MAX_ENTRIES = 1000;

/**
 * Frame sources for the localhost development exception — the CSP
 * counterpart of isLocalhost. The IPv6 loopback is absent because the CSP
 * host-source grammar has no form for an IPv6 literal.
 */
const LOCALHOST_FRAME_SOURCES = ['http://localhost:*', 'http://127.0.0.1:*', 'http://*.localhost:*'];

interface ParsedHost {
  hostname: string;
  port: string | null;
}

/**
 * Split a "hostname[:port]" string into lowercase hostname (trailing dot
 * removed) and port.
 */
function parseHost(host: string): ParsedHost {
  const lower = host.trim().toLowerCase();
  const colon = lower.lastIndexOf(':');
  const hasPort = colon !== -1 && /^\d+$/.test(lower.slice(colon + 1));
  const hostname = (hasPort ? lower.slice(0, colon) : lower).replace(/\.$/, '');
  return { hostname, port: hasPort ? lower.slice(colon + 1) : null };
}

/**
 * The apex↔www counterpart of a hostname: "www.example.com" ↔ "example.com".
 * Returns null when stripping "www." would leave a bare TLD.
 */
function wwwTwin(hostname: string): string | null {
  if (hostname.startsWith('www.')) {
    const apex = hostname.slice(4);
    return apex.includes('.') ? apex : null;
  }
  return `www.${hostname}`;
}

/**
 * Service for managing widget domain configuration.
 *
 * Owns the single matching rule for a calendar's allowed domain — used both
 * for Origin validation on the widget API and for the frame-ancestors policy
 * on the widget HTML shell — so the two can never disagree about which sites
 * may embed a calendar.
 */
class WidgetDomainService {
  private frameAncestorsCache = new Map<string, { policy: string; expiresAt: number }>();

  /**
   * @param calendarService - Resolves calendars for getFrameAncestors; the
   *   other methods do not need it
   */
  constructor(private calendarService?: CalendarService) {}

  /**
   * Validate domain format.
   * Domain must not include protocol or path, and must be a valid domain pattern.
   *
   * @param domain - Domain to validate
   * @returns True if valid, false otherwise
   */
  isValidDomain(domain: string): boolean {
    if (!domain || domain.trim() === '') {
      return false;
    }

    // Reject domains with protocol
    if (domain.includes('://')) {
      return false;
    }

    // Reject domains with path
    if (domain.includes('/')) {
      return false;
    }

    // Reject domains with spaces
    if (domain.includes(' ')) {
      return false;
    }

    // Basic domain validation: letters, numbers, dots, hyphens, and optional port
    const domainPattern = /^[a-z0-9.-]+(:\d+)?$/i;
    if (!domainPattern.test(domain)) {
      return false;
    }

    // Must have at least one dot (e.g., "example.com")
    if (!domain.includes('.')) {
      return false;
    }

    return true;
  }

  /**
   * Set the allowed domain for the calendar's widget.
   *
   * The domain is stored lowercased with any trailing dot removed, keeping
   * the apex or www form the owner entered.
   *
   * @param calendar - Calendar to set domain for
   * @param domain - Domain to allow (without protocol), or null to clear
   * @throws InvalidDomainFormatError if domain format is invalid
   * @throws CalendarNotFoundError if calendar entity is not found
   */
  async setAllowedDomain(calendar: Calendar, domain: string | null): Promise<void> {
    if (domain !== null && !this.isValidDomain(domain)) {
      throw new InvalidDomainFormatError();
    }

    const calendarEntity = await CalendarEntity.findByPk(calendar.id);
    if (!calendarEntity) {
      throw new CalendarNotFoundError();
    }

    let normalized: string | null = null;
    if (domain !== null) {
      const { hostname, port } = parseHost(domain);
      normalized = port ? `${hostname}:${port}` : hostname;
    }

    await calendarEntity.update({ widget_allowed_domain: normalized });
    calendar.widgetAllowedDomain = normalized;
    this.frameAncestorsCache.delete(calendar.urlName);
  }

  /**
   * Clear the allowed domain for the calendar's widget.
   *
   * @param calendar - Calendar to clear domain for
   */
  async clearAllowedDomain(calendar: Calendar): Promise<void> {
    await this.setAllowedDomain(calendar, null);
  }

  /**
   * Get the allowed domain for a calendar's widget.
   *
   * @param calendar - Calendar to get domain for
   * @returns The allowed domain or null if not set
   */
  getAllowedDomain(calendar: Calendar): string | null {
    return calendar.widgetAllowedDomain;
  }

  /**
   * Whether a requesting host falls within an owner's allowed domain.
   *
   * Case-insensitive and trailing-dot-insensitive; the apex and its www.
   * twin are equivalent whichever form the owner entered; other subdomains
   * never match. A port is significant only when the owner entered one.
   *
   * @param allowedDomain - The owner's configured domain ("host[:port]")
   * @param requestHost - The requesting host ("host[:port]")
   * @returns True if the request host is covered by the allowed domain
   */
  matchesAllowedDomain(allowedDomain: string, requestHost: string): boolean {
    const allowed = parseHost(allowedDomain);
    const request = parseHost(requestHost);

    if (allowed.port !== null && allowed.port !== request.port) {
      return false;
    }

    return request.hostname === allowed.hostname
      || request.hostname === wwwTwin(allowed.hostname);
  }

  /**
   * Build the widget shell's frame-ancestors policy for an allowed domain.
   *
   * Always permits 'self' (the instance's own admin preview) and localhost
   * (the development exception, as in isOriginAllowed). A configured domain
   * adds it and its www twin over https — on any port unless the owner pinned
   * one. With no valid domain configured, embedding elsewhere is disabled.
   *
   * @param allowedDomain - The calendar's configured domain, or null
   * @returns A complete Content-Security-Policy header value
   */
  frameAncestorsFor(allowedDomain: string | null): string {
    const sources = ["'self'"];

    // Re-validate: this value is written into a response header.
    if (allowedDomain && this.isValidDomain(allowedDomain)) {
      const { hostname, port } = parseHost(allowedDomain);
      const portSuffix = `:${port ?? '*'}`;
      sources.push(`https://${hostname}${portSuffix}`);
      const twin = wwwTwin(hostname);
      if (twin) {
        sources.push(`https://${twin}${portSuffix}`);
      }
    }

    sources.push(...LOCALHOST_FRAME_SOURCES);
    return `frame-ancestors ${sources.join(' ')}`;
  }

  /**
   * Resolve the widget shell's frame-ancestors policy for a calendar by URL
   * name, cached for FRAME_ANCESTORS_CACHE_TTL_MS.
   *
   * An unknown calendar gets the same policy as an unconfigured one, so the
   * header reveals nothing about which calendars exist.
   *
   * @param calendarUrlName - The calendar URL name from the widget path
   * @returns A complete Content-Security-Policy header value
   */
  async getFrameAncestors(calendarUrlName: string): Promise<string> {
    const cached = this.frameAncestorsCache.get(calendarUrlName);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.policy;
    }

    if (!this.calendarService) {
      throw new Error('WidgetDomainService.getFrameAncestors requires a CalendarService');
    }

    const calendar = await this.calendarService.getCalendarByName(calendarUrlName);
    const policy = this.frameAncestorsFor(calendar?.widgetAllowedDomain ?? null);

    if (this.frameAncestorsCache.size >= FRAME_ANCESTORS_CACHE_MAX_ENTRIES) {
      this.frameAncestorsCache.clear();
    }
    this.frameAncestorsCache.set(calendarUrlName, {
      policy,
      expiresAt: Date.now() + FRAME_ANCESTORS_CACHE_TTL_MS,
    });

    return policy;
  }

  /**
   * Extract domain from Origin header.
   * Removes protocol and returns just the domain/hostname with optional port.
   *
   * @param origin - Origin header value (e.g., "https://example.com:8080")
   * @returns Domain without protocol (e.g., "example.com:8080")
   */
  private extractDomain(origin: string): string {
    try {
      const url = new URL(origin);
      // Return hostname with port if present
      return url.port ? `${url.hostname}:${url.port}` : url.hostname;
    }
    catch {
      // If URL parsing fails, return the original string
      return origin;
    }
  }

  /**
   * Check if an origin is localhost.
   * Localhost exception allows development testing without configuration.
   *
   * @param origin - Origin to check
   * @returns True if origin is localhost or 127.0.0.1
   */
  private isLocalhost(origin: string): boolean {
    try {
      const url = new URL(origin);
      const hostname = url.hostname.toLowerCase();

      return hostname === 'localhost' ||
             hostname === '127.0.0.1' ||
             hostname === '[::1]' || // IPv6 localhost
             hostname.endsWith('.localhost'); // Subdomains of localhost
    }
    catch {
      // If URL parsing fails, do a simple string check
      const lowerOrigin = origin.toLowerCase();
      return lowerOrigin.includes('localhost') || lowerOrigin.includes('127.0.0.1');
    }
  }

  /**
   * Check if an Origin header is allowed to embed the widget.
   * Includes automatic localhost exception for development.
   *
   * @param calendar - Calendar to check permissions for
   * @param origin - Origin header value from request
   * @returns True if origin is allowed, false otherwise
   */
  isOriginAllowed(calendar: Calendar, origin: string): boolean {
    if (!origin) {
      return false;
    }

    // Localhost exception - always allow for development
    if (this.isLocalhost(origin)) {
      return true;
    }

    // If no domain is configured, disallow
    if (!calendar.widgetAllowedDomain) {
      return false;
    }

    return this.matchesAllowedDomain(calendar.widgetAllowedDomain, this.extractDomain(origin));
  }
}

export default WidgetDomainService;
