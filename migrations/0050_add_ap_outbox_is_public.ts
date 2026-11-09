import { Sequelize, DataTypes, QueryTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add `is_public` to ap_outbox and backfill it for the rows already stored.
 *
 * The public outbox (ActivityPubService.readOutbox) used to serve every row of
 * a public type whose processed_status was exactly 'ok'. That dropped a public
 * activity whose delivery to one follower failed, and served activities that
 * were never the calendar's to publish: a local editor's Update to a remote
 * calendar is signed by the user actor, addressed only to that calendar, and
 * anchored on a local calendar's outbox. Membership is now a stored,
 * write-once fact of each row (DEC-024), set at insert by
 * `isPublicOutboxActivity` in src/server/activitypub/helper/outbox.ts.
 *
 * It is a column rather than a query-time filter because the rule needs JSON
 * predicates that differ between SQLite and PostgreSQL, and the page query
 * would lose idx_ap_outbox_calendar_message_time. The backfill therefore runs
 * in JS, in batches, with no dialect-specific JSON SQL.
 *
 * Nothing is deleted: a row that is not public stays in ap_outbox, unserved.
 */

/** Rows read per backfill batch. */
const BATCH_SIZE = 500;

const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';

/**
 * Public-outbox membership for rows stored before this migration.
 *
 * A frozen copy, deliberately not an import of `isPublicOutboxActivity`: a
 * migration must keep meaning what it meant when it ran, and the live rule may
 * change (a change to it is a new backfill migration, not an edit here). It
 * also differs from the live rule in two ways, both by ruling:
 *
 *   - A row with no addressing at all (to, cc, bto, bcc and audience all
 *     absent, null, [] or '') is public. Activities written before public
 *     addressing was added (2026-04-30) carry none, and they are the
 *     calendar's oldest originals.
 *   - The actor is compared by path, `/calendars/<url_name>`, not by whole
 *     URL, so a changed instance domain keeps its history.
 *
 * The actor is parsed with URL, never matched as a substring. Anything
 * malformed is not public and does not throw.
 *
 * @param message - The stored message, already parsed from JSON
 * @param calendarUrlName - The url_name of the row's calendar
 */
export function backfillIsPublic(message: unknown, calendarUrlName: unknown): boolean {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return false;
  }
  if (typeof calendarUrlName !== 'string' || calendarUrlName === '') {
    return false;
  }
  const stored = message as Record<string, unknown>;
  const actor = stored.actor;
  if (typeof actor !== 'string') {
    return false;
  }

  let actorPath: string;
  try {
    actorPath = new URL(actor).pathname;
  }
  catch {
    return false;
  }
  if (actorPath !== `/calendars/${calendarUrlName}`) {
    return false;
  }

  const addressed = [...storedAddressList(stored.to), ...storedAddressList(stored.cc)];
  if (addressed.includes(AS_PUBLIC) || addressed.includes(`${actor}/followers`)) {
    return true;
  }

  return ['to', 'cc', 'bto', 'bcc', 'audience'].every(field => isEmptyAddressing(stored[field]));
}

/** A stored addressing field, which may be one IRI or a list, as a list of IRIs. */
function storedAddressList(value: unknown): string[] {
  if (typeof value === 'string') {
    return value === '' ? [] : [value];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

/** Empty addressing is absent, null, [] or ''; anything else, readable or not, is addressing. */
function isEmptyAddressing(value: unknown): boolean {
  return value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0);
}

/** The stored message as an object: SQLite returns JSON as text, PostgreSQL parsed. */
function parseStoredMessage(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw;
  }
  try {
    return JSON.parse(raw);
  }
  catch {
    return null;
  }
}

type BackfillRow = { id: string; message: unknown; url_name: string | null };

export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'ap_outbox', 'is_public', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    // Keyset paging on the primary key, so each batch is an index range and
    // the loop ends after reading every row once.
    let after: string | null = null;
    for (;;) {
      const rows: BackfillRow[] = await sequelize.query(
        `SELECT o.id, o.message, c.url_name
           FROM ap_outbox o
           LEFT JOIN calendar c ON c.id = o.calendar_id
          ${after === null ? '' : 'WHERE o.id > :after'}
          ORDER BY o.id
          LIMIT :limit`,
        { replacements: { after, limit: BATCH_SIZE }, type: QueryTypes.SELECT },
      );
      if (rows.length === 0) {
        break;
      }

      const publicIds = rows
        .filter(row => backfillIsPublic(parseStoredMessage(row.message), row.url_name))
        .map(row => row.id);
      if (publicIds.length > 0) {
        await sequelize.query(
          'UPDATE ap_outbox SET is_public = :isPublic WHERE id IN (:ids)',
          { replacements: { isPublic: true, ids: publicIds } },
        );
      }

      if (rows.length < BATCH_SIZE) {
        break;
      }
      after = rows[rows.length - 1].id;
    }
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'ap_outbox', 'is_public');
  },
};
