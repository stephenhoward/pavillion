import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add applicant email-confirmation columns + extend status enum on
 * `account_application`.
 *
 * Foundation migration for epic pv-l9wv (email-confirmation step for public
 * account applications). The applicant has no pre-existing identity for an
 * AccountSecretsEntity-style sidecar to attach to, so the token is stored
 * inline on the application row itself. Columns are nulled by the service
 * layer on successful consume so they don't sit as long-lived noise on every
 * row.
 *
 * Schema changes:
 * 1. Add `confirmation_token` (STRING, nullable) — 16-byte hex token
 *    generated at apply-time and consumed at confirm-time.
 * 2. Add `confirmation_token_expiration` (DATE, nullable) — 7-day expiry
 *    matching the invitation pattern. Compound naming style mirrors the
 *    existing `password_reset_expiration` column on `account_secrets`.
 * 3. Extend the `status` enum from `pending | rejected` to
 *    `pending_confirmation | pending | rejected`. No backfill — existing
 *    `pending` rows stay at `pending` (they were created before the
 *    confirmation step existed and were either implicitly trusted or
 *    accepted/rejected by an admin already).
 *
 * Dialect handling:
 * - SQLite stores Sequelize ENUM columns as plain TEXT with no CHECK
 *   constraint (verified empirically: the column DDL emitted by
 *   queryInterface.createTable for an ENUM column on SQLite is
 *   `status TEXT DEFAULT 'pending'`). Adding `'pending_confirmation'` as a
 *   valid value therefore requires no SQLite-side migration step.
 * - PostgreSQL stores ENUMs as a real `enum_<table>_<column>` type and
 *   requires `ALTER TYPE ... ADD VALUE` to extend it. We branch on dialect
 *   and emit the ALTER TYPE only on Postgres.
 *
 * Down path:
 * - Both columns are removed with `removeColumnIfExists`.
 * - The Postgres enum value addition is **not** reversed: PostgreSQL does not
 *   support removing a value from an existing enum type, and a full enum
 *   recreate (CREATE TYPE … new, ALTER TABLE … TYPE, DROP TYPE … old) would
 *   require coordinated downtime and risks corrupting any in-flight
 *   `pending_confirmation` rows. Documented here per
 *   `agent-os/standards/backend/migrations` (which permits irreversibility
 *   when the reverse step is impractical, provided the rationale is
 *   recorded). On SQLite, the enum value addition was a no-op so there is
 *   nothing to reverse there either.
 *
 * Reference: bead pv-l9wv.1.1 (Migration + entity columns + status enum
 * extension).
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(
      queryInterface,
      'account_application',
      'confirmation_token',
      {
        type: DataTypes.STRING,
        allowNull: true,
      },
    );

    await addColumnIfNotExists(
      queryInterface,
      'account_application',
      'confirmation_token_expiration',
      {
        type: DataTypes.DATE,
        allowNull: true,
      },
    );

    // Extend the status enum on Postgres only. SQLite stores Sequelize
    // ENUMs as plain TEXT with no CHECK constraint, so the new value is
    // already accepted there with no DDL change.
    if (sequelize.getDialect() === 'postgres') {
      // IF NOT EXISTS guards re-runs (Postgres 9.6+).
      await sequelize.query(
        `ALTER TYPE "enum_account_application_status" ADD VALUE IF NOT EXISTS 'pending_confirmation'`,
      );
    }
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(
      queryInterface,
      'account_application',
      'confirmation_token_expiration',
    );

    await removeColumnIfExists(
      queryInterface,
      'account_application',
      'confirmation_token',
    );

    // Intentional no-op: see header comment for the rationale on why the
    // Postgres enum value addition is not reversed (and is a no-op on
    // SQLite).
  },
};
