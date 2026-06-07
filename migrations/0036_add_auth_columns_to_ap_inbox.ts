import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add `auth_source` and `auth_origin` columns to `ap_inbox`.
 *
 * Foundation for DEC-011 ("Inbox is the Authenticated-Activity Log") and the
 * unified follow-backfill ingest path (epic pv-wy2u). Every row in `ap_inbox`
 * records how it was authenticated (`auth_source`) and against which remote
 * server (`auth_origin`):
 *
 *   - `auth_source` is an open string enum. Known values today are
 *     `'http_signature'` (live inbox POST verified by HTTP Signatures) and
 *     `'outbox_pull'` (rows written by follow-backfill from a signed-GET
 *     outbox crawl). Future ingest paths (e.g., `'ics_pull'`) can add their
 *     own value without a migration.
 *   - `auth_origin` is the verified origin (scheme + host) of the
 *     authenticating party — keyId origin for HTTP signatures, the
 *     outbox host for `outbox_pull`. Nullable because the live HTTP path
 *     may fail to parse keyId and falls back to null.
 *
 * `auth_source` is `NOT NULL DEFAULT 'http_signature'` so existing rows are
 * backfilled by PostgreSQL when the column is added (metadata-only on
 * PostgreSQL >=11). No NULL-column deploy window.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'ap_inbox', 'auth_source', {
      type: DataTypes.STRING(64),
      allowNull: false,
      defaultValue: 'http_signature',
    });

    await addColumnIfNotExists(queryInterface, 'ap_inbox', 'auth_origin', {
      type: DataTypes.STRING(2048),
      allowNull: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'ap_inbox', 'auth_origin');
    await removeColumnIfExists(queryInterface, 'ap_inbox', 'auth_source');
  },
};
