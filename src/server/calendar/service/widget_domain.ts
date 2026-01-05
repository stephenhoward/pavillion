import { Calendar } from '@/common/model/calendar';
import { CalendarEntity } from '@/server/calendar/entity/calendar';

/**
 * Service for managing widget domain configuration.
 * Handles setting/clearing the allowed domain and Origin validation.
 */
class WidgetDomainService {

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
   * @param calendar - Calendar to set domain for
   * @param domain - Domain to allow (without protocol), or null to clear
   * @throws Error if domain format is invalid
   */
  async setAllowedDomain(calendar: Calendar, domain: string | null): Promise<void> {
    if (domain !== null && !this.isValidDomain(domain)) {
      throw new Error('Invalid domain format. Domain must not include protocol or path.');
    }

    const calendarEntity = await CalendarEntity.findByPk(calendar.id);
    if (!calendarEntity) {
      throw new Error('Calendar not found');
    }

    await calendarEntity.update({ widget_allowed_domain: domain });
    calendar.widgetAllowedDomain = domain;
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
    catch (error) {
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
    catch (error) {
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

    // Extract domain from origin (remove protocol)
    const requestDomain = this.extractDomain(origin);

    // Check if domain matches the configured allowed domain
    return requestDomain === calendar.widgetAllowedDomain;
  }
}

export default WidgetDomainService;
