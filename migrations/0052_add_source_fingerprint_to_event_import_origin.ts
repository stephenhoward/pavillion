import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add `source_fingerprint` to the event_import_origin table.
 *
 * The import pipeline records a hash of the mapped source data each time it
 * writes an event, so a later file upload whose data hashes the same can leave
 * the event alone instead of rewriting it and federating an Update. Nullable
 * and not backfilled: rows written before this column existed are updated once
 * on their next upload and then carry a fingerprint.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'event_import_origin', 'source_fingerprint', {
      type: DataTypes.STRING(64),
      allowNull: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'event_import_origin', 'source_fingerprint');
  },
};
