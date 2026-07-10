import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
  changeColumnNullability,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add file-upload support to import_source.
 *
 * The ICS import feature originally modelled every source as a live URL that
 * the sync pipeline polls. This migration lets the same table also represent a
 * one-shot uploaded .ics file (organizer migration onboarding — see epic
 * pv-84da) without introducing a second entity.
 *
 * Three schema changes:
 * - `source_type` ENUM('url','file') NOT NULL DEFAULT 'url' — the
 *   discriminator that tells the pipeline how the source was intaken. The
 *   default backfills every existing row to 'url', preserving current
 *   behaviour for all live sync subscriptions.
 * - `original_filename` VARCHAR(255) NULL — the uploaded file's display name,
 *   surfaced in the admin UI for file sources; NULL for url sources.
 * - `url` becomes nullable — a file source has no live URL to store. URL
 *   sources continue to carry a non-null url (enforced at the service layer,
 *   since the column can no longer enforce it for both variants).
 *
 * SQLite caveat: relaxing a column's nullability (and removing columns) forces
 * Sequelize to rebuild the table from `describeTable` metadata, which does not
 * carry ON DELETE / ON UPDATE actions — silently dropping the calendar_id
 * CASCADE. After any such rebuild we re-assert that foreign key so calendar
 * deletion still cascades to its import sources. On PostgreSQL these are
 * in-place ALTERs that leave the FK untouched, so the fix-up is skipped there.
 *
 * Reference: bead pv-84da.1.1 (ICS file upload import — schema foundation).
 */

/**
 * Re-assert the calendar_id → calendar ON DELETE/UPDATE CASCADE foreign key.
 *
 * Only needed on SQLite, where the nullability/column-removal rebuilds above
 * drop the cascade actions. Rebuilding the table via a single changeColumn on
 * calendar_id restores the cascade (from the attributes passed here) while
 * preserving every other column's current shape (from describeTable).
 */
async function restoreCalendarCascadeOnSqlite(sequelize: Sequelize): Promise<void> {
  if (sequelize.getDialect() !== 'sqlite') {
    return;
  }
  await sequelize.getQueryInterface().changeColumn('import_source', 'calendar_id', {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'calendar', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });
}

export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'import_source', 'source_type', {
      type: DataTypes.ENUM('url', 'file'),
      allowNull: false,
      defaultValue: 'url',
    });

    await addColumnIfNotExists(queryInterface, 'import_source', 'original_filename', {
      type: DataTypes.STRING(255),
      allowNull: true,
    });

    await changeColumnNullability(queryInterface, 'import_source', 'url', {
      type: DataTypes.STRING(2048),
      allowNull: true,
    });

    await restoreCalendarCascadeOnSqlite(sequelize);
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Reverse in the opposite order: restore the url NOT NULL constraint
    // first, then drop the two new columns.
    await changeColumnNullability(queryInterface, 'import_source', 'url', {
      type: DataTypes.STRING(2048),
      allowNull: false,
    });

    await removeColumnIfExists(queryInterface, 'import_source', 'original_filename');
    await removeColumnIfExists(queryInterface, 'import_source', 'source_type');

    await restoreCalendarCascadeOnSqlite(sequelize);
  },
};
