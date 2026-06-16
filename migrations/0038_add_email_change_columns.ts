import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add email-change token columns to the `account_secrets` sidecar.
 *
 * Foundation migration for the email-change flow. The token lives on the
 * existing per-account secrets sidecar alongside the password-reset token,
 * mirroring the `password_reset_*` precedent exactly: the code is stored RAW
 * (not hashed), with a nullable expiration timestamp. The pending new email
 * address is held until the change is confirmed, after which the service
 * layer nulls all three columns so they don't sit as long-lived noise.
 *
 * Schema changes (all on `account_secrets`):
 * 1. `email_change_code` (STRING, nullable) — raw token generated at
 *    request-time and consumed at confirm-time.
 * 2. `email_change_expiration` (DATE, nullable) — expiry timestamp,
 *    matching the `password_reset_expiration` naming style.
 * 3. `email_change_new_email` (STRING, nullable) — the requested new email
 *    address, applied to the account only on successful confirmation.
 *
 * No enum changes. Fully reversible: the down path removes each column with
 * `removeColumnIfExists`.
 *
 * Reference: bead pv-91a3.1.1 (Migration + entity columns).
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(
      queryInterface,
      'account_secrets',
      'email_change_code',
      {
        type: DataTypes.STRING,
        allowNull: true,
      },
    );

    await addColumnIfNotExists(
      queryInterface,
      'account_secrets',
      'email_change_expiration',
      {
        type: DataTypes.DATE,
        allowNull: true,
      },
    );

    await addColumnIfNotExists(
      queryInterface,
      'account_secrets',
      'email_change_new_email',
      {
        type: DataTypes.STRING,
        allowNull: true,
      },
    );
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(
      queryInterface,
      'account_secrets',
      'email_change_new_email',
    );

    await removeColumnIfExists(
      queryInterface,
      'account_secrets',
      'email_change_expiration',
    );

    await removeColumnIfExists(
      queryInterface,
      'account_secrets',
      'email_change_code',
    );
  },
};
