import { Sequelize } from 'sequelize';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('migrations');

/**
 * Add 'rel-me' as a valid value to the import_source.verification_type enum.
 *
 * The verification_type column was created by migration 0026 with a single
 * value, 'dns-txt'. This migration extends the discriminator to include
 * 'rel-me', a request-time HTTP-based ownership-verification mechanism that
 * does not require any new column on import_source (the rel-me URL is
 * supplied at verification time and is not persisted).
 *
 * Dialect handling:
 * - PostgreSQL: extend the named enum type with `ALTER TYPE ... ADD VALUE
 *   IF NOT EXISTS`. PostgreSQL 12+ permits this inside a transaction, which
 *   matches the migration runner's transactional wrapper. The enum type name
 *   follows Sequelize's convention `enum_<table>_<column>` —
 *   `enum_import_source_verification_type` — established in migration 0026.
 * - SQLite: no-op. Sequelize's `DataType.ENUM` does not emit a CHECK
 *   constraint on SQLite, so the column already accepts arbitrary string
 *   values; the new 'rel-me' value can be inserted without any schema change.
 *
 * Down migration: documented as not-reversible. PostgreSQL does not provide
 * a safe way to remove a value from an enum type once added (any rows still
 * referencing the value would be left dangling). Per the
 * backend-migrations standard, the down path is a no-op.
 *
 * Reference: bead pv-jutm.1.2 (rel-me verification path foundation).
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const dialect = sequelize.getDialect();

    if (dialect === 'postgres') {
      // ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent and safe to
      // re-run. Quoting matches the type name Sequelize creates for the
      // verification_type ENUM column on the import_source table.
      await sequelize.query(
        `ALTER TYPE "enum_import_source_verification_type" ADD VALUE IF NOT EXISTS 'rel-me'`,
      );
    }
    else {
      // SQLite (and any other non-Postgres dialect) does not enforce ENUM
      // values at the DB layer under Sequelize's implementation, so no
      // schema change is required for the new value to be insertable.
      logger.info(
        { dialect },
        'Skipping ALTER TYPE for non-Postgres dialect (ENUM not enforced at DB layer)',
      );
    }
  },

  async down(_args: { context: Sequelize }) {
    // PostgreSQL does not support removing values from an enum type. Any
    // rows referencing the value would be orphaned, and the type cannot be
    // safely altered in place. Per the backend-migrations standard, this
    // down path is intentionally a no-op.
    logger.info(
      'Down migration is a no-op: enum values cannot be safely removed in PostgreSQL',
    );
  },
};
