import { Sequelize, DataTypes, QueryTypes } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

/**
 * Data Migration: Per-Account to Per-Calendar Subscriptions and Grants
 *
 * Converts existing per-account subscriptions and complimentary grants to
 * per-calendar records. Runs AFTER the schema migration (0010) that created
 * the calendar_subscription table and added nullable calendar_id to
 * complimentary_grant.
 *
 * Subscription amount distribution:
 *   - Single calendar: full amount
 *   - Multiple calendars: even split, remainder allocated to first calendar
 *
 * After data migration, tightens complimentary_grant.calendar_id to NOT NULL
 * and updates the unique partial index to include calendar_id.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // --- 1. Expand subscriptions to calendar_subscription rows ---

    // Find all non-cancelled subscriptions
    const subscriptions = await sequelize.query<{
      id: string;
      account_id: string;
      amount: number;
    }>(
      `SELECT id, account_id, amount FROM user_subscription WHERE status != 'cancelled'`,
      { type: QueryTypes.SELECT },
    );

    for (const sub of subscriptions) {
      // Find calendars owned by this account
      const calendars = await sequelize.query<{ calendar_id: string }>(
        `SELECT calendar_id FROM calendar_member
         WHERE account_id = :accountId AND role = 'owner' AND calendar_id IS NOT NULL`,
        {
          replacements: { accountId: sub.account_id },
          type: QueryTypes.SELECT,
        },
      );

      if (calendars.length === 0) {
        console.warn(
          `[migration 0011] Subscription ${sub.id}: account ${sub.account_id} has no calendars, skipping`,
        );
        continue;
      }

      // Distribute amount across calendars
      const baseAmount = Math.floor(sub.amount / calendars.length);
      const remainder = sub.amount - baseAmount * calendars.length;

      for (let i = 0; i < calendars.length; i++) {
        const amount = i === 0 ? baseAmount + remainder : baseAmount;
        const now = new Date().toISOString();

        await sequelize.query(
          `INSERT INTO calendar_subscription (id, subscription_id, calendar_id, amount, end_time, created_at)
           VALUES (:id, :subscriptionId, :calendarId, :amount, NULL, :createdAt)`,
          {
            replacements: {
              id: uuidv4(),
              subscriptionId: sub.id,
              calendarId: calendars[i].calendar_id,
              amount,
              createdAt: now,
            },
            type: QueryTypes.INSERT,
          },
        );
      }
    }

    // --- 2. Expand complimentary grants to per-calendar ---

    // Find all active grants that have not yet been assigned a calendar
    const grants = await sequelize.query<{
      id: string;
      account_id: string;
      expires_at: string | null;
      reason: string | null;
      granted_by: string;
      created_at: string;
    }>(
      `SELECT id, account_id, expires_at, reason, granted_by, created_at
       FROM complimentary_grant
       WHERE revoked_at IS NULL AND calendar_id IS NULL`,
      { type: QueryTypes.SELECT },
    );

    for (const grant of grants) {
      const calendars = await sequelize.query<{ calendar_id: string }>(
        `SELECT calendar_id FROM calendar_member
         WHERE account_id = :accountId AND role = 'owner' AND calendar_id IS NOT NULL`,
        {
          replacements: { accountId: grant.account_id },
          type: QueryTypes.SELECT,
        },
      );

      if (calendars.length === 0) {
        console.warn(
          `[migration 0011] Grant ${grant.id}: account ${grant.account_id} has no calendars, skipping`,
        );
        continue;
      }

      // Assign the first calendar to the existing grant row
      await sequelize.query(
        `UPDATE complimentary_grant SET calendar_id = :calendarId WHERE id = :id`,
        {
          replacements: { calendarId: calendars[0].calendar_id, id: grant.id },
          type: QueryTypes.UPDATE,
        },
      );

      // Create new grant rows for remaining calendars
      for (let i = 1; i < calendars.length; i++) {
        await sequelize.query(
          `INSERT INTO complimentary_grant (id, account_id, calendar_id, expires_at, reason, granted_by, revoked_at, revoked_by, created_at)
           VALUES (:id, :accountId, :calendarId, :expiresAt, :reason, :grantedBy, NULL, NULL, :createdAt)`,
          {
            replacements: {
              id: uuidv4(),
              accountId: grant.account_id,
              calendarId: calendars[i].calendar_id,
              expiresAt: grant.expires_at,
              reason: grant.reason,
              grantedBy: grant.granted_by,
              createdAt: grant.created_at,
            },
            type: QueryTypes.INSERT,
          },
        );
      }
    }

    // --- 3. Delete grants for accounts with no calendars (still NULL calendar_id) ---
    // These are skipped grants that cannot be assigned. We revoke them rather than delete.
    await sequelize.query(
      `UPDATE complimentary_grant
       SET revoked_at = :now, revoked_by = granted_by
       WHERE revoked_at IS NULL AND calendar_id IS NULL`,
      {
        replacements: { now: new Date().toISOString() },
        type: QueryTypes.UPDATE,
      },
    );

    // --- 4. Drop old unique partial index and create new one ---
    // The old index enforces one active grant per account; the new one
    // enforces one active grant per (account, calendar).
    try {
      await sequelize.query('DROP INDEX IF EXISTS idx_complimentary_grant_unique_active');
    }
    catch {
      // SQLite uses different syntax; try alternative
      try {
        await queryInterface.removeIndex('complimentary_grant', 'idx_complimentary_grant_unique_active');
      }
      catch {
        console.warn('[migration 0011] Could not drop idx_complimentary_grant_unique_active, may not exist');
      }
    }

    await sequelize.query(
      `CREATE UNIQUE INDEX idx_complimentary_grant_unique_active_calendar
       ON complimentary_grant (account_id, calendar_id)
       WHERE revoked_at IS NULL`,
    );

    // --- 5. Tighten calendar_id to NOT NULL ---
    // SQLite does not support ALTER COLUMN, so we handle this differently per dialect
    const dialect = sequelize.getDialect();
    if (dialect === 'postgres') {
      await sequelize.query(
        'ALTER TABLE complimentary_grant ALTER COLUMN calendar_id SET NOT NULL',
      );
    }
    else {
      // For SQLite (dev/test): column constraint changes are not supported.
      // The entity already declares allowNull: false, so Sequelize will enforce
      // this at the application level. In production (Postgres), the DB constraint
      // is properly set.
      console.log('[migration 0011] Skipping ALTER COLUMN NOT NULL for SQLite (enforced at application level)');
    }
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // --- 1. Make calendar_id nullable again ---
    const dialect = sequelize.getDialect();
    if (dialect === 'postgres') {
      await sequelize.query(
        'ALTER TABLE complimentary_grant ALTER COLUMN calendar_id DROP NOT NULL',
      );
    }

    // --- 2. Restore old unique index ---
    try {
      await sequelize.query('DROP INDEX IF EXISTS idx_complimentary_grant_unique_active_calendar');
    }
    catch {
      try {
        await queryInterface.removeIndex('complimentary_grant', 'idx_complimentary_grant_unique_active_calendar');
      }
      catch {
        console.warn('[migration 0011] Could not drop idx_complimentary_grant_unique_active_calendar');
      }
    }

    await sequelize.query(
      `CREATE UNIQUE INDEX idx_complimentary_grant_unique_active
       ON complimentary_grant (account_id)
       WHERE revoked_at IS NULL`,
    );

    // --- 3. Set calendar_id to NULL on all grants ---
    await sequelize.query(
      'UPDATE complimentary_grant SET calendar_id = NULL',
      { type: QueryTypes.UPDATE },
    );

    // --- 4. Delete all calendar_subscription rows ---
    await sequelize.query(
      'DELETE FROM calendar_subscription',
      { type: QueryTypes.BULKDELETE },
    );
  },
};
