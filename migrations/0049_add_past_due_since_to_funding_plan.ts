import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add `past_due_since` to the funding_plan table.
 *
 * A past-due plan keeps its calendars covered until the instance grace period
 * runs out, and the grace-period job suspends it then. Both used to measure
 * the grace from `updatedAt`, which every write to the row moves: a holder who
 * never paid could cancel and resume (or have the provider echo any schedule
 * or billing-cycle change) once per grace period and keep paid features until
 * the provider's own dunning ended. `past_due_since` records the instant the
 * plan entered `past_due` and nothing else writes it, so the grace runs from
 * the failure, whatever happens to the row afterwards.
 *
 * Existing past-due rows are backfilled from `updatedAt`: it is the best
 * estimate the table holds, and it is the clock those rows were being judged
 * by until now, so no plan's grace moves in either direction on deploy. Every
 * other row keeps NULL — the column means nothing outside `past_due`.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'funding_plan', 'past_due_since', {
      type: DataTypes.DATE,
      allowNull: true,
    });

    // Only rows still unset, so a second run never moves a recorded instant.
    await sequelize.query(
      `UPDATE funding_plan
         SET past_due_since = "updatedAt"
       WHERE status = 'past_due' AND past_due_since IS NULL`,
    );
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'funding_plan', 'past_due_since');
  },
};
