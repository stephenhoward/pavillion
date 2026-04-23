import { Sequelize, DataTypes } from 'sequelize';
import {
  createTableIfNotExists,
  tableExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Create import_run table.
 *
 * Stores one row per ICS import attempt for a given import_source, recording
 * the outcome, counts of events affected, and any error details. Provides
 * an audit trail and operational visibility for scheduled imports.
 *
 * Design:
 * - ON DELETE CASCADE on import_source_id so run history is cleaned up when
 *   the source is removed.
 * - ENUM outcome column captures both success and distinct failure modes for
 *   dashboard filtering.
 * - Counts default to 0 so a freshly inserted row has well-defined values
 *   before the runner populates them.
 *
 * Reference: bead pv-1qcp.1.1 (ICS import foundation).
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await createTableIfNotExists(queryInterface, 'import_run', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      import_source_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'import_source',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      started_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      finished_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      outcome: {
        type: DataTypes.ENUM(
          'success',
          'no_changes',
          'fetch_error',
          'parse_error',
          'ssrf_blocked',
          'dns_error',
        ),
        allowNull: false,
      },
      events_created: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      events_updated: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      events_skipped_locally_edited: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      events_disappeared: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    // Index on import_source_id for efficient per-source history lookups.
    await queryInterface.addIndex('import_run', ['import_source_id'], {
      name: 'idx_import_run_source',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    if (await tableExists(queryInterface, 'import_run')) {
      await queryInterface.dropTable('import_run');
    }
  },
};
