import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add `listed` column to the calendar table.
 *
 * `listed` controls whether a calendar appears on the public discovery page
 * at `/view/`. Pre-feature, every calendar was implicitly listed, so existing
 * rows must backfill to true on deployment. NOT NULL with DEFAULT true does
 * both jobs: PostgreSQL applies the default to existing rows when the column
 * is added, and new rows inherit the default unless explicitly opted out.
 *
 * Foundation for pv-u4ew (public discovery page) — all downstream service,
 * API, and frontend work depends on this column existing and round-tripping
 * through the Calendar entity/model.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'calendar', 'listed', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'calendar', 'listed');
  },
};
