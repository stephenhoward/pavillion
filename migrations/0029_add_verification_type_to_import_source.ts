import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add verification_type discriminator column to import_source.
 *
 * The ICS import foundation (pv-1qcp) ships with a single trust mechanism:
 * DNS TXT verification. The existing verification columns
 * (`verification_state`, `verification_token`, `verified_at`,
 * `verification_expires_at`) implicitly assume that mechanism. We introduce
 * `verification_type` now as a single-value discriminator ENUM so later
 * verifier beads (e.g. rel-me, OAuth provider-connection delegation) can
 * extend the enum atomically alongside the code that stamps the new value.
 *
 * Design notes:
 * - `verification_type` answers "which trust mechanism was used"; it is
 *   stable for the life of the source and layered orthogonally to
 *   `verification_state` ("is the current trust still valid").
 * - The sync gate (`SyncService.assertVerifiedForSync`) continues to
 *   branch on `verification_state` alone — this migration is purely
 *   additive and does not change readiness semantics.
 * - Only `'dns-txt'` is defined today. Future verifier beads add their
 *   own enum value in the same migration that introduces the verifier
 *   (atomic change pattern — no speculative placeholders).
 * - Backfill: the column is added in a single step with
 *   `allowNull: false` and `defaultValue: 'dns-txt'`. Postgres 11+ and
 *   SQLite both apply the default to existing rows during
 *   `ADD COLUMN NOT NULL DEFAULT`, so no separate UPDATE step is
 *   required. On Postgres 11+ this is a metadata-only change (no table
 *   rewrite).
 *
 * Reference: bead pv-44qj.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'import_source', 'verification_type', {
      type: DataTypes.ENUM('dns-txt'),
      allowNull: false,
      defaultValue: 'dns-txt',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'import_source', 'verification_type');

    // Drop the Postgres enum type left behind by removeColumn when no
    // other column references it. SQLite has no type to drop.
    const dialect = sequelize.getDialect();
    if (dialect === 'postgres') {
      await sequelize.query(
        `DROP TYPE IF EXISTS "enum_import_source_verification_type"`,
      );
    }
  },
};
