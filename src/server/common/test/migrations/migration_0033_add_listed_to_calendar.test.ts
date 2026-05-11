import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize, DataTypes, QueryTypes } from 'sequelize';
import migration from '../../../../../migrations/0033_add_listed_to_calendar';

/**
 * Migration 0033 adds `listed BOOLEAN NOT NULL DEFAULT true` to the calendar
 * table. Two semantic guarantees the downstream public-discovery work in
 * pv-u4ew depends on:
 *
 *   1. New rows inserted without an explicit `listed` value pick up the
 *      DEFAULT true automatically — public discovery's safe default is "show
 *      every newly-created calendar unless the owner opts out."
 *   2. Pre-existing rows that were written before the column existed
 *      backfill to true when the column is added. Otherwise a deployment
 *      would silently unlist every calendar on the instance.
 *
 * Both assertions exercise behavior that the entity/model round-trip test
 * cannot reach (the model layer never sees the DB-level DEFAULT or the
 * backfill path).
 */
describe('Migration 0033: add listed to calendar', () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    // Minimal calendar table mirroring the pre-0033 production schema. We
    // only need columns relevant to inserting rows; the migration's only
    // job is to add the `listed` column.
    await sequelize.getQueryInterface().createTable('calendar', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      url_name: { type: DataTypes.STRING, allowNull: false },
      languages: { type: DataTypes.STRING, allowNull: true },
      default_date_range: { type: DataTypes.STRING, allowNull: true },
      widget_allowed_domain: { type: DataTypes.STRING, allowNull: true },
      default_event_image_id: { type: DataTypes.UUID, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  });

  afterEach(async () => {
    await sequelize.close();
  });

  async function insertCalendar(row: {
    id: string;
    url_name: string;
  }) {
    const now = new Date().toISOString();
    await sequelize.query(
      `INSERT INTO calendar (id, url_name, "createdAt", "updatedAt")
       VALUES (:id, :url_name, :now, :now)`,
      {
        replacements: { id: row.id, url_name: row.url_name, now },
        type: QueryTypes.INSERT,
      },
    );
  }

  async function selectListed(id: string): Promise<unknown> {
    const [row] = await sequelize.query(
      'SELECT listed FROM calendar WHERE id = :id',
      {
        replacements: { id },
        type: QueryTypes.SELECT,
      },
    ) as Array<{ listed: unknown }>;
    return row?.listed;
  }

  it('backfills `listed` to true on pre-existing rows', async () => {
    // Seed two rows before the column exists — these represent the rows
    // already in production at deploy time. They must all become listed=true
    // when the migration runs; otherwise a deploy silently unlists every
    // calendar on the instance.
    await insertCalendar({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      url_name: 'preexisting-one',
    });
    await insertCalendar({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
      url_name: 'preexisting-two',
    });

    await migration.up({ context: sequelize });

    expect(
      Boolean(await selectListed('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')),
    ).toBe(true);
    expect(
      Boolean(await selectListed('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2')),
    ).toBe(true);
  });

  it('applies DEFAULT true to rows inserted without an explicit `listed`', async () => {
    await migration.up({ context: sequelize });

    // Post-migration insert that omits `listed` entirely. The DB-level
    // DEFAULT must populate it as true so callers (e.g. the calendar
    // service creating a new calendar) do not have to thread the value
    // through every insert site.
    const now = new Date().toISOString();
    await sequelize.query(
      `INSERT INTO calendar (id, url_name, "createdAt", "updatedAt")
       VALUES (:id, :url_name, :now, :now)`,
      {
        replacements: {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          url_name: 'post-migration-default',
          now,
        },
        type: QueryTypes.INSERT,
      },
    );

    expect(
      Boolean(await selectListed('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')),
    ).toBe(true);
  });

  it('down removes the `listed` column', async () => {
    await migration.up({ context: sequelize });

    const afterUp = await sequelize.getQueryInterface().describeTable('calendar');
    expect('listed' in afterUp).toBe(true);

    await migration.down({ context: sequelize });

    const afterDown = await sequelize.getQueryInterface().describeTable('calendar');
    expect('listed' in afterDown).toBe(false);
  });

  it('is idempotent on a second up run', async () => {
    await migration.up({ context: sequelize });
    await migration.up({ context: sequelize });

    const desc = await sequelize.getQueryInterface().describeTable('calendar');
    expect('listed' in desc).toBe(true);
  });
});
