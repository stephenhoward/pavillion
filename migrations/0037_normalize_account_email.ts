import { Sequelize, QueryTypes } from 'sequelize';
import { addIndexIfNotExists, removeIndexIfExists } from '../src/server/common/migrations/helpers.js';

/**
 * Normalize stored email addresses (lowercase + trim) and enforce
 * case-insensitive uniqueness on `account.email`.
 *
 * Context: email lookups normalize (`normalizeEmail`) at every read/write
 * boundary in the accounts + authentication services, but rows written before
 * that change were persisted verbatim. A lookup for a normalized address could
 * therefore miss an existing account stored mixed-case (e.g. `Victim@x.com`),
 * and — with no unique constraint on `account.email` — a registration for
 * `victim@x.com` would be treated as available and create a case-duplicate
 * account. This migration backfills existing rows to the normalized form and
 * adds a unique index as a backstop against exact-string duplicates.
 *
 * Uniqueness model: the index is a plain unique index on the raw `email`
 * column, so the DB layer enforces only EXACT-STRING uniqueness. It is NOT a
 * functional or COLLATE-based case-insensitive index. Case-insensitive
 * uniqueness holds because every writer funnels the address through
 * `normalizeEmail` before persisting (application-level discipline); the index
 * then catches any two writes of the same normalized string. A writer that
 * bypassed `normalizeEmail` could still persist a mixed-case duplicate — the
 * write boundary, not the index, is the case-collapse guarantee.
 *
 * Order matters:
 *   1. Collision pre-check on `account` BEFORE any mutation. If two or more
 *      account rows normalize to the same value the migration throws and leaves
 *      all data untouched, surfacing the conflicting account IDs (never the
 *      plaintext email addresses — privacy-playbook) so an operator can resolve
 *      the duplicates and re-run. Auto-merging case-duplicate accounts is an
 *      ops/data decision and intentionally out of scope here.
 *   2. Backfill `account`, `account_application`, and `account_invitation` to
 *      the normalized form with standard SQL `LOWER`/`TRIM` (dual-dialect; no
 *      `citext`). NULL emails are left untouched.
 *   3. Add a unique index on `account.email` via `CREATE UNIQUE INDEX`
 *      (`addIndexIfNotExists`). This emits a plain index on both SQLite and
 *      PostgreSQL — no table rebuild. NULL emails are treated as distinct on
 *      both dialects, so null-email accounts do not collide.
 *
 * The `account_application` and `account_invitation` tables carry lifecycle
 * state; uniqueness there is a separate behavioral decision and is NOT enforced
 * — they receive normalization + backfill only.
 *
 * down(): drops the unique index only. The lowercase/trim backfill is
 * IRREVERSIBLE — the original casing is not preserved and cannot be restored.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Step 1: collision pre-check on `account`. Run before any UPDATE so an
    // abort leaves every table unmodified. The grouping query is dialect-
    // portable; per-group IDs are fetched separately to avoid SQLite's
    // GROUP_CONCAT vs PostgreSQL's STRING_AGG split. Only account IDs are
    // surfaced — never the plaintext email addresses (privacy-playbook).
    const collisions = await sequelize.query<{ norm: string }>(
      `SELECT LOWER(TRIM(email)) AS norm
       FROM account
       WHERE email IS NOT NULL
       GROUP BY LOWER(TRIM(email))
       HAVING COUNT(*) > 1`,
      { type: QueryTypes.SELECT },
    );

    if (collisions.length > 0) {
      const idGroups: string[] = [];
      for (const { norm } of collisions) {
        const rows = await sequelize.query<{ id: string }>(
          `SELECT id FROM account
           WHERE email IS NOT NULL AND LOWER(TRIM(email)) = :norm
           ORDER BY id`,
          { replacements: { norm }, type: QueryTypes.SELECT },
        );
        idGroups.push(`[${rows.map((r) => r.id).join(', ')}]`);
      }
      throw new Error(
        'Migration 0037 aborted: multiple account rows normalize to the same '
        + 'email address. Resolve these case-duplicate accounts manually, then '
        + 're-run. Conflicting account ID groups (no other data shown): '
        + idGroups.join('; '),
      );
    }

    // Step 2: backfill normalized email on every table that stores one.
    for (const table of ['account', 'account_application', 'account_invitation']) {
      await sequelize.query(
        `UPDATE ${table}
         SET email = LOWER(TRIM(email))
         WHERE email IS NOT NULL AND email <> LOWER(TRIM(email))`,
        { type: QueryTypes.UPDATE },
      );
    }

    // Step 3: enforce case-insensitive uniqueness on account.email.
    await addIndexIfNotExists(
      queryInterface,
      'account',
      ['email'],
      {
        name: 'account_email_unique',
        unique: true,
      },
    );
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    // Only the unique index is reversible. The normalization backfill is
    // irreversible: original casing was not preserved and is not restored.
    await removeIndexIfExists(queryInterface, 'account', 'account_email_unique');
  },
};
