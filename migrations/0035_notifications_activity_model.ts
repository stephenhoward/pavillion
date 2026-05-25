import { Sequelize, DataTypes } from 'sequelize';
import {
  createTableIfNotExists,
  tableExists,
  addIndexIfNotExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Replace the single `notification` table with the activity/recipient
 * two-table model.
 *
 * The old schema was hard-coded for `follow` and `repost` verbs and could not
 * represent multi-recipient activities, polymorphic objects, or local-origin
 * actions. The new model factors each real-world event into a
 * `notification_activity` row (one per AP-style "Actor A did Verb V on Object
 * O") and a `notification_recipient` row per addressed account, allowing
 * fan-out without duplicating activity data and supporting both AP- and
 * locally-originated triggers uniformly.
 *
 * Wipe is justified by Phase 1 Launch Readiness: pre-production notification
 * rows have no archival value, and the new schema cannot be cleanly
 * backfilled from the old one (`type` → `verb` mostly maps, but actor URL/
 * name move to denormalized snapshots and `account_id` splits across two
 * tables).
 *
 * Schema:
 * - `notification_activity` carries the activity-level fields plus snapshot
 *   actor/object display strings and DB-level ENUM constraints on `verb`,
 *   `origin`, `actor_kind`, and `object_type`. `object_id` is intentionally
 *   not a FK — the activity log is polymorphic and the `object_label`
 *   snapshot keeps rows renderable after the underlying object is gone.
 * - `notification_recipient` is the fan-out row with `(notification_activity_id,
 *   account_id)` unique and FK cascade from activity → recipient so cleanup
 *   removes the recipient rows automatically.
 *
 * Down recreates the old `notification` table (column set per migration
 * 0005) so the runner's down path lands on a schema the prior code expects.
 * No data is restored — the down is a structural revert only.
 *
 * Dialect handling mirrors the pattern in migration 0031:
 * - SQLite stores Sequelize ENUM columns as TEXT with no CHECK constraint
 *   (dev/test path). Idempotent re-run is via `createTableIfNotExists` /
 *   `tableExists`.
 * - PostgreSQL stores ENUMs as `enum_<table>_<column>` types. The down path
 *   explicitly drops the four enum types after dropping the tables, because
 *   `queryInterface.dropTable` does not cascade to the named enum types and
 *   leaving them behind would break a re-run of `up`.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    const isPostgres = sequelize.getDialect() === 'postgres';

    // Step 1: drop the old `notification` table if it exists. The wipe is
    // intentional per the design — pre-launch data has no archival value and
    // the schema delta is too wide to justify a backfill.
    if (await tableExists(queryInterface, 'notification')) {
      await queryInterface.dropTable('notification');
    }

    // Step 2: on Postgres, defensively drop any leftover enum types from a
    // prior partial run of this migration. SQLite has no enum types to drop.
    // This keeps the migration idempotent on re-run after a transaction
    // rollback, which matters for `npm run dev` reset/reseed cycles.
    if (isPostgres) {
      await sequelize.query('DROP TYPE IF EXISTS "enum_notification_activity_verb" CASCADE');
      await sequelize.query('DROP TYPE IF EXISTS "enum_notification_activity_origin" CASCADE');
      await sequelize.query('DROP TYPE IF EXISTS "enum_notification_activity_actor_kind" CASCADE');
      await sequelize.query('DROP TYPE IF EXISTS "enum_notification_activity_object_type" CASCADE');
    }

    // Step 3: create `notification_activity`. One row per real-world event
    // regardless of how many recipients see it.
    await createTableIfNotExists(queryInterface, 'notification_activity', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      verb: {
        // Starter verb catalog. Adding a verb is a
        // future schema migration, not a config change.
        type: DataTypes.ENUM(
          'Follow',
          'Announce',
          'Flag',
          'ReportEscalated',
          'ReportResolved',
          'EditorInvited',
          'EditorRevoked',
        ),
        allowNull: false,
      },
      origin: {
        // 'local' vs 'federated' is metadata only. Treat both paths
        // identically downstream; the discriminator is for display/audit.
        type: DataTypes.ENUM('local', 'federated'),
        allowNull: false,
      },
      actor_kind: {
        // Discriminator over the (actor_account_id, actor_uri) pair.
        // 'anonymous' covers Flag rows (no identity stored at all) and
        // anonymous web-form submissions; 'system' covers scheduler-driven
        // activities (e.g. auto-escalation).
        type: DataTypes.ENUM('account', 'remote_actor', 'anonymous', 'system'),
        allowNull: false,
      },
      actor_account_id: {
        // Set only when actor_kind='account'. Never set for Flag rows
        // (anonymized at insert time).
        // No FK reference: actor account deletion should not break the
        // activity log — the actor_display_name/url snapshots remain.
        type: DataTypes.UUID,
        allowNull: true,
      },
      actor_uri: {
        // Set only when actor_kind='remote_actor'. Never set for Flag rows.
        type: DataTypes.TEXT,
        allowNull: true,
      },
      actor_display_name: {
        // Snapshot. Always populated. Sanitized at insert time. May be
        // anonymized per verb policy (Flag rows store "Anonymous reporter"
        // or "Reporter from <host>" here).
        type: DataTypes.TEXT,
        allowNull: false,
      },
      actor_display_url: {
        // Snapshot. May be NULL (fully anonymous Flag, system actor) or the
        // instance root URL when anonymized per verb policy.
        type: DataTypes.TEXT,
        allowNull: true,
      },
      object_type: {
        // Polymorphic discriminator. Adding a new object type is a future
        // schema migration, not a config change.
        type: DataTypes.ENUM('calendar', 'event', 'report'),
        allowNull: false,
      },
      object_id: {
        // No FK constraint — the activity log is heterogeneous in what it
        // references and the snapshot object_label keeps rows renderable
        // after the underlying object is gone.
        type: DataTypes.UUID,
        allowNull: false,
      },
      object_label: {
        // Snapshot of the most useful display string. Sanitized at insert
        // time. Plain text — clients must never v-html this.
        type: DataTypes.TEXT,
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    // Index supports the dedup-window lookup keyed on
    // (verb, object_type, object_id) plus the dismissForObject query path
    // that joins recipient → activity on (object_type, object_id).
    await addIndexIfNotExists(
      queryInterface,
      'notification_activity',
      ['object_type', 'object_id'],
      { name: 'idx_notification_activity_object' },
    );

    // Note: the per-verb dedup index is intentionally deferred. The dedup
    // tuple is `(verb, actor_account_id|actor_uri, object_type, object_id)`
    // within a 10-minute window — a leading `verb` index is low-cardinality
    // and does not cover the selective columns. The correct composite index
    // design lands with the recordActivity implementation in pv-89mw.3.4.

    // Step 4: create `notification_recipient`. Fan-out, one row per
    // (notification_activity, account).
    await createTableIfNotExists(queryInterface, 'notification_recipient', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      notification_activity_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'notification_activity',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        // Cascade delete with notification_activity so the 90-day retention
        // pass automatically removes recipient rows when the parent
        // activity ages out.
        onDelete: 'CASCADE',
      },
      account_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        // Recipient rows are scoped to the account; when the account is
        // deleted there is no one to read the inbox.
        onDelete: 'CASCADE',
      },
      seen_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      dismissed_at: {
        // Set either by user action or by the object-scoped dismissal
        // mechanism (e.g. moderation:report:resolved → dismissForObject).
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    // Unique constraint
    // recipient row per activity (cross-recipient dedup is enforced at the
    // activity level; this guards against double-fan-out within a single
    // recordActivity call or concurrent retries).
    await addIndexIfNotExists(
      queryInterface,
      'notification_recipient',
      ['notification_activity_id', 'account_id'],
      {
        name: 'unique_notification_recipient_activity_account',
        unique: true,
      },
    );

    // Index supports the per-account inbox query
    // (GET /api/v1/notification scoped to account_id).
    await addIndexIfNotExists(
      queryInterface,
      'notification_recipient',
      ['account_id', 'created_at'],
      { name: 'idx_notification_recipient_account_created_at' },
    );
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    const isPostgres = sequelize.getDialect() === 'postgres';

    // Drop the new tables in reverse FK order (recipient depends on
    // activity).
    if (await tableExists(queryInterface, 'notification_recipient')) {
      await queryInterface.dropTable('notification_recipient');
    }
    if (await tableExists(queryInterface, 'notification_activity')) {
      await queryInterface.dropTable('notification_activity');
    }

    // On Postgres, `dropTable` does not cascade to the named enum types it
    // created. Remove them explicitly so a subsequent up runs cleanly.
    if (isPostgres) {
      await sequelize.query('DROP TYPE IF EXISTS "enum_notification_activity_verb" CASCADE');
      await sequelize.query('DROP TYPE IF EXISTS "enum_notification_activity_origin" CASCADE');
      await sequelize.query('DROP TYPE IF EXISTS "enum_notification_activity_actor_kind" CASCADE');
      await sequelize.query('DROP TYPE IF EXISTS "enum_notification_activity_object_type" CASCADE');
    }

    // Recreate the old `notification` table per migration 0005's schema so
    // the runner's down path lands on the schema prior code expects. No
    // data is restored — the down is structural only.
    await createTableIfNotExists(queryInterface, 'notification', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      account_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'account',
          key: 'id',
        },
        // Mirror migration 0005's original schema: notification rows are
        // cascade-deleted when the recipient account is removed.
        onDelete: 'CASCADE',
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      event_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      actor_name: {
        type: DataTypes.STRING(256),
        allowNull: false,
      },
      actor_url: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      seen: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    await addIndexIfNotExists(queryInterface, 'notification', ['account_id'], {
      name: 'notification_account_id_idx',
    });
    await addIndexIfNotExists(queryInterface, 'notification', ['created_at'], {
      name: 'notification_created_at_idx',
    });
  },
};
