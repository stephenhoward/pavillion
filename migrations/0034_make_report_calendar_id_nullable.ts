import { Sequelize, DataTypes } from 'sequelize';
import { changeColumnNullability } from '../src/server/common/migrations/helpers.js';

/**
 * Make `report.calendar_id` nullable.
 *
 * Before this change, every report row had to belong to a local calendar.
 * That made it impossible for an instance admin on a follower instance to
 * file a moderation report against an event hosted on a remote (alpha)
 * calendar: the only path through `ModerationService.createReport(...)`
 * required a non-null `calendarId`, and remote events have
 * `event.calendarId === null` on the follower.
 *
 * Invariant after this migration: `report.calendar_id IS NULL` iff the
 * reported event is remote on this instance. Local reports continue to
 * carry a calendar_id.
 *
 * No data backfill: no production rows have calendar_id === null because
 * the column was NOT NULL.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await changeColumnNullability(queryInterface, 'report', 'calendar_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await changeColumnNullability(queryInterface, 'report', 'calendar_id', {
      type: DataTypes.UUID,
      allowNull: false,
    });
  },
};
