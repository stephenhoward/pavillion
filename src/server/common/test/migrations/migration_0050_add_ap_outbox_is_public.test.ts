import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize, DataTypes, QueryTypes } from 'sequelize';
import migration from '../../../../../migrations/0050_add_ap_outbox_is_public';

/**
 * Migration 0050 adds `ap_outbox.is_public` and backfills it from each stored
 * row's message (DEC-024). The backfill decides which of a calendar's existing
 * activities its public outbox keeps serving, so this test runs it over one
 * row of every shape the outbox holds and checks each verdict.
 *
 * It runs on in-memory SQLite by default. CI runs only migrations up and down
 * on PostgreSQL, so the backfill is checked there by hand: with
 * DB_DIALECT=postgres and the DB_HOST / DB_PORT / DB_NAME / DB_USER /
 * DB_PASSWORD variables set, the same cases run against that database. Use a
 * scratch database — the test drops and recreates `calendar` and `ap_outbox`.
 */
const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';
const DOMAIN = 'pavillion.test';
const OUR_CALENDAR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CALENDAR_ID = '22222222-2222-4222-8222-222222222222';
const OUR_ACTOR = `https://${DOMAIN}/calendars/ourcal`;
const OTHER_ACTOR = `https://${DOMAIN}/calendars/othercal`;
const FOLLOWERS = `${OUR_ACTOR}/followers`;
const USER_ACTOR = `https://${DOMAIN}/users/editor`;
const REMOTE_CALENDAR = 'https://peer.example/calendars/theirs';

const onPostgres = process.env.DB_DIALECT === 'postgres';

function openDatabase(): Sequelize {
  if (onPostgres) {
    return new Sequelize({
      dialect: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME,
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      logging: false,
    });
  }
  return new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
}

describe('Migration 0050: add is_public to ap_outbox', () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = openDatabase();
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.dropTable('ap_outbox');
    await queryInterface.dropTable('calendar');

    // The pre-0050 columns the backfill reads.
    await queryInterface.createTable('calendar', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      url_name: { type: DataTypes.STRING, allowNull: false },
    });
    await queryInterface.createTable('ap_outbox', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      type: { type: DataTypes.STRING },
      message_time: { type: DataTypes.DATE },
      message: { type: DataTypes.JSON },
      calendar_id: { type: DataTypes.UUID },
      processed_time: { type: DataTypes.DATE },
      processed_status: { type: DataTypes.STRING },
    });

    await sequelize.query(
      'INSERT INTO calendar (id, url_name) VALUES (:ours, \'ourcal\'), (:other, \'othercal\')',
      { replacements: { ours: OUR_CALENDAR_ID, other: OTHER_CALENDAR_ID } },
    );
  });

  afterEach(async () => {
    await sequelize.close();
  });

  /** Inserts a row with `message` stored as given: an object is serialized, a string is stored raw. */
  async function insertRow(id: string, type: string, message: unknown, calendarId: string = OUR_CALENDAR_ID): Promise<void> {
    await sequelize.query(
      `INSERT INTO ap_outbox (id, type, message_time, message, calendar_id, processed_time, processed_status)
       VALUES (:id, :type, :time, :message, :calendarId, :time, 'ok')`,
      {
        replacements: {
          id,
          type,
          time: new Date('2026-03-01T00:00:00Z'),
          message: typeof message === 'string' ? message : JSON.stringify(message),
          calendarId,
        },
      },
    );
  }

  async function isPublic(id: string): Promise<boolean> {
    const rows = await sequelize.query<{ is_public: boolean | number }>(
      'SELECT is_public FROM ap_outbox WHERE id = :id',
      { replacements: { id }, type: QueryTypes.SELECT },
    );
    expect(rows, `row ${id}`).toHaveLength(1);
    return Boolean(rows[0].is_public);
  }

  it('adds a non-null is_public column', async () => {
    await migration.up({ context: sequelize });

    const description = await sequelize.getQueryInterface().describeTable('ap_outbox');
    expect(description.is_public).toBeDefined();
    expect(description.is_public.allowNull).toBe(false);
  });

  it('backfills each stored row by the backfill rule', async () => {
    const publicAddressing = { to: [AS_PUBLIC], cc: [FOLLOWERS] };
    const expected: Record<string, boolean> = {};
    async function row(id: string, type: string, message: unknown, isPublicExpected: boolean, calendarId?: string) {
      await insertRow(id, type, message, calendarId);
      expected[id] = isPublicExpected;
    }

    await row('public-create', 'Create', { id: 'public-create', type: 'Create', actor: OUR_ACTOR, ...publicAddressing, object: { type: 'Event' } }, true);
    await row('paired-note', 'Create', { id: 'paired-note', type: 'Create', actor: OUR_ACTOR, ...publicAddressing, object: { type: 'Note' } }, true);
    await row('announce', 'Announce', { id: 'announce', type: 'Announce', actor: OUR_ACTOR, ...publicAddressing, object: 'https://peer.example/events/1' }, true);
    await row('delete', 'Delete', { id: 'delete', type: 'Delete', actor: OUR_ACTOR, ...publicAddressing, object: `${OUR_ACTOR}/events/1` }, true);
    await row('followers-only-update', 'Update', { id: 'followers-only-update', type: 'Update', actor: OUR_ACTOR, to: [FOLLOWERS] }, true);
    await row('to-as-string', 'Create', { id: 'to-as-string', type: 'Create', actor: OUR_ACTOR, to: AS_PUBLIC }, true);
    // Written before public addressing existed: the calendar's oldest originals.
    await row('no-addressing', 'Announce', { id: 'no-addressing', type: 'Announce', actor: OUR_ACTOR, object: 'https://peer.example/events/2' }, true);

    await row('user-actor-update-to-remote', 'Update', { id: 'user-actor-update-to-remote', type: 'Update', actor: USER_ACTOR, to: [REMOTE_CALENDAR] }, false);
    await row('user-actor-public', 'Update', { id: 'user-actor-public', type: 'Update', actor: USER_ACTOR, to: [AS_PUBLIC], cc: [`${USER_ACTOR}/followers`] }, false);
    await row('other-calendar-actor-public', 'Create', { id: 'other-calendar-actor-public', type: 'Create', actor: OTHER_ACTOR, to: [AS_PUBLIC], cc: [`${OTHER_ACTOR}/followers`] }, false);
    await row('bto-only', 'Create', { id: 'bto-only', type: 'Create', actor: OUR_ACTOR, bto: [REMOTE_CALENDAR] }, false);
    await row('direct-follow', 'Follow', { id: 'direct-follow', type: 'Follow', actor: OUR_ACTOR, to: [REMOTE_CALENDAR] }, false);
    // Malformed rows: each is not public, and none stops the backfill.
    await row('message-not-an-object', 'Create', '"not an activity"', false);
    await row('message-null', 'Create', 'null', false);
    await row('actor-not-a-url', 'Create', { id: 'actor-not-a-url', actor: 'not a url', to: [AS_PUBLIC] }, false);
    await row('orphan-calendar', 'Create', { id: 'orphan-calendar', actor: OUR_ACTOR, to: [AS_PUBLIC] }, false, '33333333-3333-4333-8333-333333333333');
    if (!onPostgres) {
      // PostgreSQL's json column refuses invalid JSON at insert; SQLite stores it.
      await row('message-invalid-json', 'Create', '{"actor": ', false);
    }

    await migration.up({ context: sequelize });

    const actual: Record<string, boolean> = {};
    for (const id of Object.keys(expected)) {
      actual[id] = await isPublic(id);
    }
    expect(actual).toEqual(expected);
  });

  it('backfills every row when the table holds more than one batch', async () => {
    const total = 1203;
    const ids = Array.from({ length: total }, (_, i) => `row-${String(i).padStart(5, '0')}`);
    // Every third row is a user-actor row, so batches carry both verdicts.
    const values = ids.map((id, i) => ({
      id,
      type: 'Create',
      message_time: new Date('2026-03-01T00:00:00Z'),
      message: JSON.stringify({ id, actor: i % 3 === 0 ? USER_ACTOR : OUR_ACTOR, to: [AS_PUBLIC] }),
      calendar_id: OUR_CALENDAR_ID,
    }));
    await sequelize.getQueryInterface().bulkInsert('ap_outbox', values);

    await migration.up({ context: sequelize });

    const counts = await sequelize.query<{ is_public: boolean | number; n: string | number }>(
      'SELECT is_public, COUNT(*) AS n FROM ap_outbox GROUP BY is_public',
      { type: QueryTypes.SELECT },
    );
    const byVerdict = Object.fromEntries(counts.map(row => [String(Boolean(row.is_public)), Number(row.n)]));
    expect(byVerdict).toEqual({ true: total - Math.ceil(total / 3), false: Math.ceil(total / 3) });
  });

  it('leaves stored rows in place: nothing is deleted', async () => {
    await insertRow('user-actor', 'Update', { actor: USER_ACTOR, to: [REMOTE_CALENDAR] });

    await migration.up({ context: sequelize });

    expect(await isPublic('user-actor')).toBe(false);
  });

  it('is idempotent on a second up run', async () => {
    await insertRow('public-create', 'Create', { actor: OUR_ACTOR, to: [AS_PUBLIC] });

    await migration.up({ context: sequelize });
    await migration.up({ context: sequelize });

    expect(await isPublic('public-create')).toBe(true);
  });

  it('down removes the is_public column', async () => {
    await migration.up({ context: sequelize });
    await migration.down({ context: sequelize });

    const description = await sequelize.getQueryInterface().describeTable('ap_outbox');
    expect(description.is_public).toBeUndefined();
  });
});
