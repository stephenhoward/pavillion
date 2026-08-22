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
 * Beta's Postgres container and credentials. Mirrors the `db_beta` service in
 * `docker-compose.federation.yml`.
 */
const BETA_DB_CONTAINER = 'pavillion-federation-db-beta';
const BETA_DB_NAME = 'beta_db';
const DB_USER = 'pavillion';

/**
 * Alpha's Postgres container and database. Mirrors the `db_alpha` service in
 * `docker-compose.federation.yml`; shares `DB_USER` with beta.
 */
const ALPHA_DB_CONTAINER = 'pavillion-federation-db-alpha';
const ALPHA_DB_NAME = 'alpha_db';

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
 * Message of the log record an inbox handler emits once an activity has been
 * validated AND persisted/processed. Emitted by
 * `logInboxActivityAccepted` (src/server/activitypub/helper/inbox-acceptance-log.ts)
 * from both the calendar inbox and the user inbox.
 *
 * Deliberately NOT the arrival line ('Received inbox activity'): that one is
 * emitted before the validation switch, so it also fires for activities the
 * handler then rejects with 400.
 */
const ACCEPTANCE_MESSAGE = 'Inbox activity accepted';

/** ANSI SGR sequences pino-pretty emits when colorize is on. */
// eslint-disable-next-line no-control-regex
const ANSI_SEQUENCE = /\u001b\[[0-9;]*m/g;

/**
 * Start of a new log record. Instances run under NODE_ENV=federation, so pino
 * renders through pino-pretty: a record is a `[HH:MM:SS.mmm]` header line
 * followed by indented continuation lines carrying the structured fields.
 * Raw pino JSON (one object per line) is also recognised so the matcher does
 * not quietly stop working if an instance logs unprettified.
 */
const RECORD_HEADER = /^(\[\d{2}:\d{2}:\d{2}\.\d{3}\]|\{")/;

/**
 * Group a log slice into whole records, stripping ANSI escapes.
 *
 * Lines preceding the first header are dropped: the `sinceLine` anchor cuts at
 * a line boundary, so a slice can open midway through a record emitted BEFORE
 * the action under test. Those orphaned continuation lines belong to the past
 * and must not be folded into the record that follows them.
 */
function splitLogRecords(logs: string): string[] {
  const records: string[] = [];
  let current: string[] | null = null;

  for (const rawLine of logs.split('\n')) {
    const line = rawLine.replace(ANSI_SEQUENCE, '');
    if (RECORD_HEADER.test(line)) {
      if (current) {
        records.push(current.join('\n'));
      }
      current = [line];
    }
    else if (current) {
      current.push(line);
    }
  }
  if (current) {
    records.push(current.join('\n'));
  }

  return records;
}

/**
 * True when the log slice contains an acceptance record for an activity of
 * `activityType` mentioning `needle`.
 *
 * All three conditions must hold within a SINGLE record. Matching across the
 * whole slice would let three unrelated records satisfy the assertion between
 * them -- including the pre-validation arrival line, which an activity
 * rejected with 400 still emits.
 *
 * Exported for direct coverage in inbox_log_matching.spec.ts.
 *
 * @param logs - Raw `docker logs` output, already sliced to the post-anchor window
 * @param activityType - ActivityPub activity type (e.g. 'Delete')
 * @param needle - Substring that must appear in the same record, typically the
 *                 activity's object IRI or an id embedded in it
 */
export function hasAcceptedInboxActivity(
  logs: string,
  activityType: string,
  needle: string,
): boolean {
  return splitLogRecords(logs).some(record =>
    record.includes(ACCEPTANCE_MESSAGE)
    && (
      record.includes(`activityType: "${activityType}"`)
      || record.includes(`"activityType":"${activityType}"`)
    )
    && record.includes(needle),
  );
}

/**
 * Poll a container's logs (only entries emitted AFTER `sinceLine`) for
 * evidence that an inbox activity of the given type, mentioning the given
 * needle, was ACCEPTED.
 *
 * Acceptance -- not arrival. The receiving handler emits its acceptance record
 * only after HTTP signature verification, activity-schema validation, and the
 * inbox write/processing have all succeeded, so a match proves the activity
 * was admitted rather than merely delivered to the route. Downstream
 * business-logic outcomes below that point (ownership verification, no-op
 * guards) remain out of scope.
 *
 * Useful when the user-facing side effect ("event gone from feed",
 * "calendar removed") is masked by ownership-verification rules or other
 * downstream rejection layers that fire below the inbox handler.
 *
 * @param containerName - Docker container name whose logs to poll
 * @param activityType - ActivityPub activity type to look for (e.g. 'Delete')
 * @param needle - Substring that must appear in the acceptance record itself
 *                 (typically the object IRI, or an event id embedded in it)
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
        if (hasAcceptedInboxActivity(logs, activityType, needle)) {
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

/**
 * A persisted `ap_inbox` or `ap_outbox` row, as read back out of an
 * instance's database. Both tables share the `ActivityPubMessageEntity` shape.
 */
export interface InboxRow {
  /** The activity's own id (its `id` property on the wire). */
  id: string;
  /** The activity type the row was filed under. */
  type: string;
  /**
   * Dispatch outcome. `null` while the row is still queued, `'ok'` once
   * `dispatchByType` returned, `'error'` when it threw, `'blocked'` /
   * `'rejected'` when the sender-policy gates refused it. This is the only
   * observable that separates "dispatched and deliberately no-opped" from
   * "written to the inbox and never dispatched".
   */
  processedStatus: string | null;
  /** The stored activity document. */
  message: Record<string, any>;
}

/**
 * Shared reader behind the per-instance, per-table wrappers below: the
 * `ap_inbox` / `ap_outbox` row in `database` whose activity embeds `objectId`
 * as its `object.id`, filed under `activityType`.
 */
function readMessageRowForObject(
  dbContainer: string,
  database: string,
  table: 'ap_inbox' | 'ap_outbox',
  activityType: string,
  objectId: string,
): InboxRow | null {
  // Test-controlled inputs, but quoted defensively so a value carrying an
  // apostrophe produces a failed match rather than a malformed query.
  const type = activityType.replace(/'/g, "''");
  const object = objectId.replace(/'/g, "''");

  const sql = `select row_to_json(r) from (
    select id, type, processed_status, message
    from ${table}
    where type = '${type}' and message->'object'->>'id' = '${object}'
  ) r`;

  let raw: string;
  try {
    raw = execSync(
      `docker exec ${dbContainer} psql -U ${DB_USER} -d ${database} -t -A -c "${sql.replace(/\n\s*/g, ' ')}"`,
      { encoding: 'utf8' },
    ).trim();
  }
  catch {
    // Container briefly unavailable; callers poll, so report "not yet".
    return null;
  }

  if (!raw) {
    return null;
  }

  const row = JSON.parse(raw);
  return {
    id: row.id,
    type: row.type,
    processedStatus: row.processed_status,
    message: row.message,
  };
}

/**
 * Read back the `ap_inbox` row on BETA whose activity embeds `objectId` as its
 * `object.id`, filed under `activityType`.
 *
 * Keyed on the embedded object rather than the row's own id because a reply
 * activity (FEP-8a8e's `Ignore` answering a `Join`, `Accept` answering a
 * `Follow`) mints its id on the responding instance — the test never sees it.
 * The id of the activity being replied to is known up front and is what makes
 * the row identifiable.
 *
 * Reads the database directly because no HTTP surface exposes `ap_inbox`, and
 * two of the fields that matter here — the stored addressing and
 * `processed_status` — appear in no log line.
 *
 * @param activityType - Value of the row's `type` column (e.g. 'Ignore')
 * @param objectId - The `id` of the activity's embedded object
 * @returns The row, or null when no row matches yet
 */
export function readBetaInboxRowForObject(
  activityType: string,
  objectId: string,
): InboxRow | null {
  return readMessageRowForObject(BETA_DB_CONTAINER, BETA_DB_NAME, 'ap_inbox', activityType, objectId);
}

/**
 * Read back the `ap_outbox` row on ALPHA whose activity embeds `objectId` as
 * its `object.id`, filed under `activityType`.
 *
 * This is the SENDER's record of the activity. `addToOutbox` persists
 * `activity.toObject()` — the serialized wire form, addressing fields
 * included — so the stored `message` shows what alpha put on the wire rather
 * than what the receiver's parser chose to keep. Use it for any assertion
 * about outbound addressing: a receiving `fromObject` drops fields it does
 * not model, so the receiver's `ap_inbox` row cannot prove their absence.
 *
 * @param activityType - Value of the row's `type` column (e.g. 'Ignore')
 * @param objectId - The `id` of the activity's embedded object
 * @returns The row, or null when no row matches yet
 */
export function readAlphaOutboxRowForObject(
  activityType: string,
  objectId: string,
): InboxRow | null {
  return readMessageRowForObject(ALPHA_DB_CONTAINER, ALPHA_DB_NAME, 'ap_outbox', activityType, objectId);
}
