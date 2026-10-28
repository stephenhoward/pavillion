import { Sequelize, DataTypes } from 'sequelize';
import {
  createTableIfNotExists,
  tableExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Create backup_drill — the durable record of restore-drill outcomes.
 *
 * scripts/restore-drill.sh proves a dump can actually be restored, but a drill
 * nobody can date is, operationally, a drill that did not happen. Each completed
 * run appends one row here so "when did a drill last pass" is answerable by a
 * machine rather than by memory.
 *
 * Design:
 * - backup_filename is a plain STRING with no foreign key and no reference to
 *   backup_metadata. This is load-bearing, not laziness. RetentionService prunes
 *   backup_metadata under GFS retention, so a cascading FK would delete the drill
 *   record along with its subject and a RESTRICT one would make retention fail —
 *   either way ordinary housekeeping would destroy the question this table exists
 *   to answer. The drill also runs against dumps that have no backup_metadata row
 *   at all (PAVILLION_BACKUP_DIR can point at an arbitrary directory), so the
 *   filename it reports may never have been recorded by this instance.
 * - ran_at is explicit rather than a Sequelize createdAt, because it is read as
 *   data (the staleness signal an operator alerts on), not as row bookkeeping.
 * - detail carries the failed check's name on a failure. The drill script only
 *   ever passes fixed string literals, so nothing derived from the dump or from
 *   pg_restore's output can reach this column.
 * - No index. A monthly drill produces roughly a dozen rows a year, so an index
 *   on (passed, ran_at) would be ceremony against a table a sequential scan reads
 *   in microseconds. The omission is a decision, not an oversight.
 * - No DB-side default for id: backup_metadata (0001_initial_schema.ts) does the
 *   same and the service supplies uuidv4().
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await createTableIfNotExists(queryInterface, 'backup_drill', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      backup_filename: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      ran_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      passed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
      },
      detail: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    if (await tableExists(queryInterface, 'backup_drill')) {
      await queryInterface.dropTable('backup_drill');
    }
  },
};
