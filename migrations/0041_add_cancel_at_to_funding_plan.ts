import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add `cancel_at` to the funding_plan table.
 *
 * A cancel-at-period-end leaves the subscription live and fully paid until the
 * end of the billing period the customer already paid for. Before this column
 * there was nowhere to record that boundary: cancel() flipped the row straight
 * to status 'cancelled', and the provider's next `customer.subscription.updated`
 * — which reports a period-end cancellation as status "active" — flipped it
 * back, leaving a row indistinguishable from one that was never cancelled.
 *
 * `cancel_at` is the effective end of a scheduled cancellation, written while
 * the plan stays 'active'. It is distinct from `cancelled_at`, which records
 * when cancellation was *requested* and is only ever written together with
 * status 'cancelled'. Nullable with no default and no backfill: existing rows
 * have no scheduled cancellation, and NULL is exactly that statement.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'funding_plan', 'cancel_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'funding_plan', 'cancel_at');
  },
};
