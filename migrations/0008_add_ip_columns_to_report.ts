import { Sequelize, DataTypes } from 'sequelize';

/**
 * Add IP Tracking Columns to Report Table
 *
 * This migration adds support for tiered IP data retention to support abuse
 * detection while respecting privacy. The three columns provide different
 * levels of specificity that can be selectively retained based on privacy
 * policies and retention schedules.
 *
 * Changes:
 * - Adds ip_hash column (STRING, nullable) - Hashed full IP for exact matching
 * - Adds ip_subnet column (STRING, nullable) - Network subnet (e.g., "192.168.1.0/24")
 * - Adds ip_region column (STRING, nullable) - Geographic region (e.g., "US-CA")
 *
 * Privacy Design:
 * - All columns nullable since not all reports will have IP data
 * - Supports graduated retention: hash expires first, then subnet, region kept longest
 * - Enables abuse pattern detection without retaining full IP addresses indefinitely
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Add ip_hash column for exact IP matching
    await queryInterface.addColumn('report', 'ip_hash', {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Hashed IP address for abuse detection (shortest retention)',
    });

    // Add ip_subnet column for network-level pattern detection
    await queryInterface.addColumn('report', 'ip_subnet', {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'IP subnet for network-level abuse patterns (medium retention)',
    });

    // Add ip_region column for geographic pattern detection
    await queryInterface.addColumn('report', 'ip_region', {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Geographic region for location-based patterns (longest retention)',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Remove ip tracking columns in reverse order
    await queryInterface.removeColumn('report', 'ip_region');
    await queryInterface.removeColumn('report', 'ip_subnet');
    await queryInterface.removeColumn('report', 'ip_hash');
  },
};
