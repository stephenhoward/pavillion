import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add `object_calendar_id` to `notification_activity`.
 *
 * The producer already holds the owning calendar when it records report
 * activities (the moderation bus payload carries `calendarId` alongside
 * `reportId`), but the activity row had nowhere to put it. Without the
 * column the read path would have to walk reportId -> ReportEntity ->
 * calendarId, which means Notifications reaching into Moderation for a
 * value the write path already had in hand. Persist it instead.
 *
 * Nullable is load-bearing, not defensive: an admin reporting a remote
 * event produces a report with no owning local calendar, so NULL is a real
 * and expected value, not an error path. NOT NULL would be wrong.
 *
 * No backfill by design. Pre-existing rows keep NULL and render exactly as
 * they do today (plain text, no calendar-scoped link), and inbox rows age
 * out under the 90-day retention pass.
 *
 * No FK constraint, matching `object_id` and `actor_account_id` on this
 * table: the activity log is a snapshot that must stay readable after the
 * referenced row is deleted. No index either — the column is read off rows
 * already selected by the recipient join and is never a query predicate.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(
      queryInterface,
      'notification_activity',
      'object_calendar_id',
      {
        type: DataTypes.UUID,
        allowNull: true,
      },
    );
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(
      queryInterface,
      'notification_activity',
      'object_calendar_id',
    );
  },
};
