import { Sequelize, DataTypes } from 'sequelize';

/**
 * Make import_source.verification_type nullable and drop its DB default.
 *
 * Migration 0026 created `verification_type` as NOT NULL with a default of
 * `'dns-txt'`, on the assumption that DNS was the only verification mechanism.
 * Migration 0029 added `'rel-me'` as a second value. With two methods now
 * available, the column needs to express a third state — "the owner has not
 * yet picked a verification method" — so the verify-ownership wizard can show
 * the method picker on first entry instead of jumping straight to DNS.
 *
 * Without this change, every newly-created source carries the DB default
 * value `'dns-txt'`, which is indistinguishable from "owner deliberately
 * chose DNS" and causes the wizard to skip the picker step. Allowing NULL
 * gives the application a real "no method chosen yet" sentinel.
 *
 * Existing rows are unaffected — they keep their concrete value. Only future
 * INSERTs that omit the column will end up NULL, and the service layer is
 * the only writer.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.changeColumn('import_source', 'verification_type', {
      type: DataTypes.ENUM('dns-txt', 'rel-me'),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Down path restores the original NOT NULL + default constraint. Any rows
    // that have NULL verification_type at this point would block the change,
    // so we backfill them to 'dns-txt' first to match the historical default.
    await sequelize.query(
      `UPDATE import_source SET verification_type = 'dns-txt' WHERE verification_type IS NULL`,
    );

    await queryInterface.changeColumn('import_source', 'verification_type', {
      type: DataTypes.ENUM('dns-txt', 'rel-me'),
      allowNull: false,
      defaultValue: 'dns-txt',
    });
  },
};
