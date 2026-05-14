/**
 * Federation Test Instance Configuration and Container Log Helpers
 *
 * This file defines the configuration for the two Pavillion instances
 * used in federation testing, plus helpers for inspecting their Docker
 * container logs. These instances are started via Docker Compose (see
 * docker-compose.federation.yml).
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

import { execSync } from 'child_process';

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
 * @returns The full actor URL (e.g., 'https://alpha.federation.local/calendars/community_events')
 */
export function formatActorUrl(calendarUrlName: string, instance: InstanceConfig): string {
  return `${instance.baseUrl}/calendars/${calendarUrlName}`;
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

/**
 * Docker container names for the two federation instances. Mirrors the
 * `container_name` entries in `docker-compose.federation.yml`.
 */
const ALPHA_CONTAINER = 'pavillion-federation-alpha';
const BETA_CONTAINER = 'pavillion-federation-beta';

/**
 * Capture the current container log line count so subsequent log inspections
 * can be restricted to entries emitted AFTER an action under test. Without
 * this anchor, a stale entry from a prior run (or a prior test in the same
 * run) could satisfy a substring assertion and produce a false positive.
 *
 * Returns 0 if the container is unavailable; callers using the return value
 * as a `sinceLine` anchor degrade to inspecting the full log in that case,
 * which is acceptable for federation e2e (container is expected to be up).
 */
function getInboxLogLineCount(containerName: string): number {
  try {
    const out = execSync(
      `docker logs ${containerName} 2>&1 | wc -l`,
      { encoding: 'utf8' },
    );
    return parseInt(out.trim(), 10) || 0;
  }
  catch {
    return 0;
  }
}

/**
 * Poll a container's logs (only entries emitted AFTER `sinceLine`) for
 * evidence that an inbox activity of the given type, mentioning the given
 * needle, was processed.
 *
 * The inbox processing pipeline runs only AFTER verifyHttpSignature accepts
 * the request. Any log entry from inbox.ts that mentions the activity type
 * and the needle is positive evidence that signed delivery reached the inbox
 * handler. Downstream business-logic outcomes (accept, reject, ownership
 * failure) are out of scope here -- we are proving that the activity
 * arrived, not that it was semantically valid.
 *
 * Useful when the user-facing side effect ("event gone from feed",
 * "calendar removed") is masked by ownership-verification rules or other
 * downstream rejection layers that fire below the inbox handler.
 *
 * @param containerName - Docker container name whose logs to poll
 * @param activityType - ActivityPub activity type to look for (e.g. 'Delete')
 * @param needle - Substring that must appear in the post-anchor log slice
 *                 (typically the event id under test)
 * @param sinceLine - Log line count captured BEFORE the action; only lines
 *                    after this offset are considered
 * @param timeoutMs - Maximum time to wait before resolving false
 * @param intervalMs - Polling interval between log inspections
 */
function waitForInboxActivity(
  containerName: string,
  activityType: string,
  needle: string,
  sinceLine: number,
  timeoutMs = 20000,
  intervalMs = 1000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      try {
        // Slice the log to only entries emitted AFTER the action under test.
        // tail -n +N starts at line N (1-indexed), so sinceLine + 1 yields
        // strictly the new entries.
        const logs = execSync(
          `docker logs ${containerName} 2>&1 | tail -n +${sinceLine + 1}`,
          { encoding: 'utf8' },
        );
        // The activityType is logged as a structured field; tolerate ANSI
        // color codes around the JSON-ish key by checking substrings.
        if (
          logs.includes(needle)
          && logs.includes('activityType')
          && logs.includes(`"${activityType}"`)
        ) {
          resolve(true);
          return;
        }
      }
      catch { /* container may briefly be unavailable */ }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/**
 * Capture the current Beta container log line count. See
 * {@link getInboxLogLineCount} for semantics.
 */
export function getBetaLogLineCount(): number {
  return getInboxLogLineCount(BETA_CONTAINER);
}

/**
 * Capture the current Alpha container log line count. See
 * {@link getInboxLogLineCount} for semantics.
 */
export function getAlphaLogLineCount(): number {
  return getInboxLogLineCount(ALPHA_CONTAINER);
}

/**
 * Beta-side wrapper around {@link waitForInboxActivity}. Polls Beta's
 * container logs for a matching inbox activity.
 */
export function waitForBetaInboxActivity(
  activityType: string,
  needle: string,
  sinceLine: number,
  timeoutMs?: number,
  intervalMs?: number,
): Promise<boolean> {
  return waitForInboxActivity(BETA_CONTAINER, activityType, needle, sinceLine, timeoutMs, intervalMs);
}

/**
 * Alpha-side wrapper around {@link waitForInboxActivity}. Polls Alpha's
 * container logs for a matching inbox activity.
 */
export function waitForAlphaInboxActivity(
  activityType: string,
  needle: string,
  sinceLine: number,
  timeoutMs?: number,
  intervalMs?: number,
): Promise<boolean> {
  return waitForInboxActivity(ALPHA_CONTAINER, activityType, needle, sinceLine, timeoutMs, intervalMs);
}
