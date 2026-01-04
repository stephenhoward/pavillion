/**
 * Federation Test Instance Configuration
 *
 * This file defines the configuration for the two Pavillion instances
 * used in federation testing. These instances are started via Docker
 * Compose (see docker-compose.federation.yml).
 *
 * Instance Naming Convention:
 * - INSTANCE_ALPHA: The "local" instance, typically used as the source of federation actions
 * - INSTANCE_BETA: The "remote" instance, typically used as the target of federation actions
 *
 * Both instances use the same seed data which creates an admin account
 * with email admin@pavillion.dev and password 'admin'. This is different
 * from the instance domain because the seed data is shared.
 *
 * Prerequisites:
 * 1. Add to /etc/hosts:
 *    127.0.0.1 alpha.federation.local
 *    127.0.0.1 beta.federation.local
 * 2. Start the federation environment: npm run federation:start
 */

/**
 * Configuration for a test instance
 */
export interface InstanceConfig {
  /** Base URL for the instance (e.g., https://alpha.federation.local) */
  baseUrl: string;
  /** Email address for the admin account */
  adminEmail: string;
  /** Password for the admin account */
  adminPassword: string;
  /** Domain name without protocol (e.g., alpha.federation.local) */
  domain: string;
}

/**
 * Instance A (Alpha) - The "local" Pavillion instance
 *
 * This instance is typically used as the source for federation actions:
 * - Creating calendars that Beta will follow
 * - Creating events that propagate to followers
 * - Initiating follow/unfollow operations
 *
 * Note: The admin credentials are from the shared seed data, not instance-specific.
 * The seed data creates admin@pavillion.dev with password 'admin'.
 */
export const INSTANCE_ALPHA: InstanceConfig = {
  baseUrl: 'https://alpha.federation.local',
  // Admin credentials from seed data (layouts/development/db/b_account.json)
  // The email is admin@pavillion.dev, not admin@alpha.federation.local
  adminEmail: 'admin@pavillion.dev',
  adminPassword: 'admin',
  domain: 'alpha.federation.local',
};

/**
 * Instance B (Beta) - The "remote" Pavillion instance
 *
 * This instance is typically used as the target for federation actions:
 * - Following calendars from Alpha
 * - Receiving events via ActivityPub
 * - Verifying event propagation worked correctly
 *
 * Note: The admin credentials are from the shared seed data, not instance-specific.
 * The seed data creates admin@pavillion.dev with password 'admin'.
 */
export const INSTANCE_BETA: InstanceConfig = {
  baseUrl: 'https://beta.federation.local',
  // Admin credentials from seed data (layouts/development/db/b_account.json)
  // The email is admin@pavillion.dev, not admin@beta.federation.local
  adminEmail: 'admin@pavillion.dev',
  adminPassword: 'admin',
  domain: 'beta.federation.local',
};

/**
 * Helper to format a WebFinger resource identifier
 *
 * @param calendarUrlName - The calendar's URL name (e.g., 'community_events')
 * @param instance - The instance configuration
 * @returns A WebFinger-compatible resource string (e.g., 'acct:community_events@alpha.federation.local')
 */
export function formatWebFingerResource(calendarUrlName: string, instance: InstanceConfig): string {
  return `acct:${calendarUrlName}@${instance.domain}`;
}

/**
 * Helper to format an ActivityPub actor URL
 *
 * @param calendarUrlName - The calendar's URL name
 * @param instance - The instance configuration
 * @returns The full actor URL (e.g., 'https://alpha.federation.local/o/community_events')
 */
export function formatActorUrl(calendarUrlName: string, instance: InstanceConfig): string {
  return `${instance.baseUrl}/o/${calendarUrlName}`;
}

/**
 * Helper to format a remote calendar identifier for the follow API
 *
 * The Pavillion follow API expects calendar identifiers in the format:
 * `calendar_name@domain` (e.g., 'community_events@alpha.federation.local')
 *
 * Note: The calendar name must match the ActivityPub username validation:
 * ^[a-z0-9_]{3,16}$ - only lowercase letters, numbers, and underscores
 *
 * @param calendarUrlName - The calendar's URL name
 * @param instance - The instance configuration
 * @returns A remote calendar identifier (e.g., 'community_events@alpha.federation.local')
 */
export function formatRemoteCalendarId(calendarUrlName: string, instance: InstanceConfig): string {
  return `${calendarUrlName}@${instance.domain}`;
}

/**
 * Generate a unique calendar URL name for testing
 *
 * Calendar URL names in Pavillion must match BOTH:
 * 1. Calendar URL validation: ^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9_]$
 * 2. ActivityPub username validation: ^[a-z0-9_]{3,16}$
 *
 * The intersection is:
 * - 3-16 characters total
 * - Only lowercase letters, numbers, and underscores (NO hyphens)
 * - Start with letter or number
 * - End with letter, number, or underscore
 *
 * This helper generates a valid unique name by combining a prefix
 * with a short random suffix (base36 encoded timestamp mod 1M).
 *
 * @param prefix - A short prefix for the calendar name (max ~6 chars recommended)
 * @returns A unique calendar URL name that passes both validations
 *
 * @example
 * generateCalendarName('alpha') // Returns something like 'alpha_k4x9a'
 * generateCalendarName('beta') // Returns something like 'beta_m2b7c'
 */
export function generateCalendarName(prefix: string): string {
  // Use last 4 chars of timestamp in base36 for uniqueness
  const uniqueSuffix = (Date.now() % 10000).toString(36);
  // Combine with underscore and add random chars to avoid collisions
  const randomChars = Math.random().toString(36).substring(2, 4);
  const name = `${prefix}_${uniqueSuffix}${randomChars}`;

  // Ensure the name is not too long (max 16 chars for ActivityPub username validation)
  if (name.length > 16) {
    return name.substring(0, 16);
  }

  return name;
}
