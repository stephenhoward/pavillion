import { Sequelize, DataTypes } from 'sequelize';
import {
  createTableIfNotExists,
  tableExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Create import_source table.
 *
 * Stores calendar-level ICS import source configurations. Each row represents
 * a subscribed ICS feed URL that a calendar owner has registered for
 * automatic import. The verification lifecycle (DNS challenge token + state
 * machine) ensures that only a verified owner can attach a remote ICS feed
 * to their calendar. Fetch bookkeeping columns (etag, content_hash,
 * last_fetched_at, last_status) support efficient polling and failure
 * diagnostics.
 *
 * Design:
 * - ON DELETE CASCADE on calendar_id so sources are cleaned up with the
 *   parent calendar.
 * - `url` is immutable after creation per security-advisor (any URL change
 *   requires creating a new source and re-verifying).
 * - ENUM columns for verification_state and last_status use DataType.ENUM
 *   for dialect-appropriate storage (Postgres enum type, SQLite check
 *   constraint).
 *
 * Reference: bead pv-1qcp.1.1 (ICS import foundation).
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await createTableIfNotExists(queryInterface, 'import_source', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      url: {
        type: DataTypes.STRING(2048),
        allowNull: false,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      verification_state: {
        type: DataTypes.ENUM('unverified', 'pending', 'verified', 'expired'),
        allowNull: false,
        defaultValue: 'unverified',
      },
      verification_token: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      verified_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      verification_expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      etag: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      content_hash: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      last_fetched_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      last_status: {
        type: DataTypes.ENUM(
          'ok',
          'fetch_error',
          'parse_error',
          'ssrf_blocked',
          'dns_error',
          'rate_limited',
        ),
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    // Index on calendar_id to speed up per-calendar source lookups.
    await queryInterface.addIndex('import_source', ['calendar_id'], {
      name: 'idx_import_source_calendar',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    if (await tableExists(queryInterface, 'import_source')) {
      await queryInterface.dropTable('import_source');
    }
  },
};
