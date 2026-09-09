import { Sequelize, QueryTypes } from 'sequelize';
import {
  addIndexIfNotExists,
  removeIndexIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Enforce one open funding allocation per calendar.
 *
 * A calendar belongs to at most one funding plan at a time. That has always
 * been the intent, but only a narrower index expressed it — unique on
 * (funding_plan_id, calendar_id) WHERE end_time IS NULL — which stops one plan
 * holding the same calendar twice and says nothing about two plans holding it
 * at once. This index carries the invariant itself.
 *
 * The narrower index is deliberately left in place. It is subsumed by this one,
 * costs little, and keeps its own meaning if split coverage is ever admitted;
 * dropping it would make that a schema migration rather than a decision.
 *
 * The index is a constraint on live paths, not only a tripwire for states we do
 * not create. Two things have to hold for it to be safe, and both are code, not
 * hope:
 *
 *  1. Every path that ends coverage writes `end_time` — removing a calendar
 *     from a plan, an immediate cancellation, and the provider's deletion
 *     event. A path that ended coverage without closing its rows would leave
 *     them open forever and collide here the next time the calendar was bought.
 *  2. Every path that opens an allocation first closes whatever it supersedes —
 *     processCheckoutCompleted and addCalendarToFundingPlan both do. Without
 *     that, a plan left `suspended` (which keeps its allocations open, and
 *     blocks neither a fresh checkout nor an add) would make an ordinary
 *     purchase fail against this index rather than an anomalous one.
 *
 * The add-calendar route maps a UniqueConstraintError to 409, so a caller who
 * races that path gets a conflict it can act on rather than a 500. That mapping
 * is specific to that route, not general: processCheckoutCompleted can also
 * reach this index (via the Stripe webhook and via the checkout-session status
 * poll) and surfaces a 500 there. Both are retry-safe rather than corrupting —
 * the whole checkout mutation is one transaction, so a rejected insert rolls
 * the plan back and the redelivery re-runs the supersession close against the
 * now-committed row.
 *
 * Pre-flight rather than backfill: rows that already violate the invariant are
 * historical coverage records, and deciding what a calendar was actually
 * covered by — and until when — is a product judgement, not something a
 * migration may infer. So this refuses to run and names the calendars, instead
 * of closing rows by guesswork.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    const duplicates = await sequelize.query<{ calendar_id: string; open_rows: number }>(
      `SELECT calendar_id, COUNT(*) AS open_rows
         FROM calendar_subscription
        WHERE end_time IS NULL
        GROUP BY calendar_id
       HAVING COUNT(*) > 1`,
      { type: QueryTypes.SELECT },
    );

    if (duplicates.length > 0) {
      const affected = duplicates.map((row) => row.calendar_id).join(', ');
      throw new Error(
        'Cannot enforce one open funding allocation per calendar: '
        + `${duplicates.length} calendar(s) already hold more than one. `
        + 'Closing them means deciding what each was covered by and until when, '
        + 'which is a data decision rather than a migration one. '
        + `Resolve these rows in calendar_subscription first: ${affected}`,
      );
    }

    await addIndexIfNotExists(queryInterface, 'calendar_subscription', ['calendar_id'], {
      name: 'idx_calendar_subscription_one_open_per_calendar',
      unique: true,
      where: { end_time: null },
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeIndexIfExists(
      queryInterface,
      'calendar_subscription',
      'idx_calendar_subscription_one_open_per_calendar',
    );
  },
};
