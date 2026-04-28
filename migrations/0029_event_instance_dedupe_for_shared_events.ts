import { Sequelize, QueryTypes } from 'sequelize';

/**
 * Collapse post-0025 duplicate `event_instance` rows for shared/reposted
 * events and normalize `calendar_id` to the originating event's calendar.
 *
 * Context: migration 0025 added a unique index on
 * `event_instance(event_id, start_time)` and deduped pre-existing race
 * residue. However, the previous shared-event materialization path
 * (`buildEventInstances` fan-out) could write per-calendar duplicates
 * whose unique-violation was caught only by the public-API materialization
 * path — other callers (eventInstanceRestored handler, seed) did not have
 * the catch + re-fetch guard, so duplicates could still slip in if they
 * were written by separate transactions.
 *
 * This migration is the data-side companion to epic pv-hr72's code change
 * (single global instance row owned by the originating calendar). It
 * cleans up any residual duplicates accumulated under the old fan-out
 * model and normalizes `event_instance.calendar_id` to match the
 * originating event's `calendar_id`.
 *
 * Step 1 — collapse duplicates:
 *   For each `(event_id, start_time)` group, keep one row. Preference
 *   order:
 *     1. The row whose `calendar_id` already equals `event.calendar_id`
 *        (i.e. the originating-calendar row that should have been the
 *        canonical row all along). The CASE expression in ORDER BY puts
 *        these rows ahead of all others.
 *     2. Lowest UUID id as a deterministic tiebreak (matches the 0025
 *        convention; UUID comparison operators are defined on both
 *        SQLite and PostgreSQL).
 *
 *   The `LEFT JOIN` on `event` ensures orphan instance rows (pointing at
 *   a deleted event) still participate in dedup using the lowest-id
 *   tiebreak — the CASE expression evaluates to 1 for both sides of the
 *   comparison since `event.calendar_id` is NULL for the missing join.
 *
 * Step 2 — normalize calendar_id:
 *   For every surviving row whose linked event has a non-null
 *   `calendar_id` and whose own `calendar_id` differs (or is NULL),
 *   overwrite `event_instance.calendar_id` with `event.calendar_id`.
 *   Remote AP-origin events (`event.calendar_id IS NULL`) are left
 *   untouched — they have no canonical local calendar, and the existing
 *   `event_instance.calendar_id` value (whatever the materialization path
 *   stored) is the best signal available.
 *
 *   This step uses a correlated subquery rather than the `UPDATE … FROM
 *   alias` form because SQLite (used in the test harness) does not
 *   support that syntax. PostgreSQL supports both; the correlated form
 *   is portable and equivalent.
 *
 * The `down` path is a no-op: collapsed duplicate rows and normalized
 * calendar_id values cannot be reconstructed. Per
 * `agent-os/standards/backend/migrations`, this is documented in the
 * down() body and surfaced via the implementation note here.
 *
 * Reference: bead pv-hr72.2 (Migration 0029 — collapse duplicate
 * event_instance rows + normalize calendar_id).
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    // Step 1: collapse duplicates preferring the row whose calendar_id
    // matches event.calendar_id; fall back to lowest UUID id.
    await sequelize.query(
      `DELETE FROM event_instance
       WHERE id IN (
         SELECT id FROM (
           SELECT ei.id,
             ROW_NUMBER() OVER (
               PARTITION BY ei.event_id, ei.start_time
               ORDER BY (CASE WHEN ei.calendar_id = e.calendar_id THEN 0 ELSE 1 END), ei.id
             ) AS rn
           FROM event_instance ei
           LEFT JOIN event e ON e.id = ei.event_id
           WHERE ei.event_id IS NOT NULL AND ei.start_time IS NOT NULL
         ) ranked
         WHERE rn > 1
       )`,
      { type: QueryTypes.DELETE },
    );

    // Step 2: normalize event_instance.calendar_id to event.calendar_id
    // for events with a non-null originating calendar. Correlated
    // subquery for SQLite portability.
    await sequelize.query(
      `UPDATE event_instance
       SET calendar_id = (
         SELECT calendar_id FROM event WHERE event.id = event_instance.event_id
       )
       WHERE EXISTS (
         SELECT 1 FROM event
         WHERE event.id = event_instance.event_id
           AND event.calendar_id IS NOT NULL
           AND (event_instance.calendar_id IS NULL
                OR event_instance.calendar_id <> event.calendar_id)
       )`,
      { type: QueryTypes.UPDATE },
    );
  },

  async down(_args: { context: Sequelize }) {
    // No-op: this migration deletes duplicate rows and overwrites
    // calendar_id values. Neither change can be reversed without the
    // pre-migration data, which is not preserved. The migration runner
    // still records the down step for bookkeeping.
  },
};
