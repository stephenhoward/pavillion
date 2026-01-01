import { Sequelize, DataTypes } from 'sequelize';

/**
 * Initial database schema migration.
 *
 * This migration creates all tables for Pavillion's initial schema,
 * derived from the 14+ Sequelize entity models.
 *
 * Tables created:
 * - account (user accounts)
 * - account_role (user roles)
 * - account_secrets (passwords and verification codes)
 * - account_application (account applications)
 * - profile (user profiles)
 * - account_invitation (invitations)
 * - calendar (calendars)
 * - calendar_content (calendar translations)
 * - calendar_editor (calendar editor permissions)
 * - event (events)
 * - event_content (event translations)
 * - event_schedule (event scheduling/recurrence)
 * - event_categories (event categories)
 * - event_category_content (category translations)
 * - event_category_assignments (event-category relationships)
 * - event_instance (generated event instances)
 * - location (event locations)
 * - media (uploaded media files)
 * - service_config (service configuration)
 * - ap_inbox (ActivityPub inbox messages)
 * - ap_outbox (ActivityPub outbox messages)
 * - ap_following (calendars we follow)
 * - ap_follower (calendars following us)
 * - ap_shared_event (shared/reposted events)
 * - ap_event_activity (event activities from other calendars)
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // =========================================
    // Core Account Tables
    // =========================================

    // account - User accounts
    await queryInterface.createTable('account', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      username: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      domain: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      language: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // account_role - User roles
    await queryInterface.createTable('account_role', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      account_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      role: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // account_secrets - Passwords and verification codes
    await queryInterface.createTable('account_secrets', {
      account_id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      salt: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      password: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      url_verification_code: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      password_reset_code: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      password_reset_expiration: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // account_application - Account applications
    await queryInterface.createTable('account_application', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      message: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('pending', 'rejected'),
        defaultValue: 'pending',
        allowNull: true,
      },
      status_timestamp: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // profile - User profiles
    await queryInterface.createTable('profile', {
      account_id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      description: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      url: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // =========================================
    // Calendar Tables
    // =========================================

    // calendar - Calendars
    await queryInterface.createTable('calendar', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      account_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      url_name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      languages: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      default_date_range: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // calendar_content - Calendar translations
    await queryInterface.createTable('calendar_content', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      language: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      description: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // calendar_editor - Calendar editor permissions
    await queryInterface.createTable('calendar_editor', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      account_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // Add unique constraint for calendar_editor
    await queryInterface.addIndex('calendar_editor', ['calendar_id', 'account_id'], {
      unique: true,
      name: 'unique_calendar_editor',
    });

    // account_invitation - Account and editor invitations
    await queryInterface.createTable('account_invitation', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      invited_by: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      message: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      invitation_code: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      expiration_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // Add index on calendar_id for invitations
    await queryInterface.addIndex('account_invitation', ['calendar_id'], {
      name: 'idx_account_invitation_calendar_id',
    });

    // =========================================
    // Location Table
    // =========================================

    // location - Event locations
    await queryInterface.createTable('location', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      address: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      city: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      state: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      postal_code: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      country: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // =========================================
    // Media Table
    // =========================================

    // media - Uploaded media files
    await queryInterface.createTable('media', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      sha256: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      original_filename: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      mime_type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      file_size: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('pending', 'approved', 'failed', 'deleted'),
        allowNull: false,
        defaultValue: 'pending',
      },
      uploaded_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      processed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    });

    // =========================================
    // Event Tables
    // =========================================

    // event - Events
    await queryInterface.createTable('event', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      event_source_url: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      parent_event_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'event',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      location_id: {
        type: DataTypes.STRING,
        allowNull: true,
        references: {
          model: 'location',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      media_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'media',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // Add index on calendar_id for events
    await queryInterface.addIndex('event', ['calendar_id'], {
      name: 'idx_event_calendar_id',
    });

    // event_content - Event translations
    await queryInterface.createTable('event_content', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      event_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'event',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      language: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      description: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // Add indexes for event_content
    await queryInterface.addIndex('event_content', ['event_id'], {
      name: 'idx_event_content_event_id',
    });
    await queryInterface.addIndex('event_content', ['name'], {
      name: 'idx_event_content_name',
    });
    await queryInterface.addIndex('event_content', ['description'], {
      name: 'idx_event_content_description',
    });

    // event_schedule - Event scheduling/recurrence
    await queryInterface.createTable('event_schedule', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      event_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'event',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      timezone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      start_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      end_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      frequency: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      interval: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      count: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      by_day: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      is_exclusion: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // event_instance - Generated event instances
    await queryInterface.createTable('event_instance', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      event_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'event',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      start_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      end_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // =========================================
    // Event Category Tables
    // =========================================

    // event_categories - Event categories
    await queryInterface.createTable('event_categories', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // event_category_content - Category translations
    await queryInterface.createTable('event_category_content', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      category_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'event_categories',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      language: {
        type: DataTypes.STRING(5),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
    });

    // event_category_assignments - Event-category relationships
    await queryInterface.createTable('event_category_assignments', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      event_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'event',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      category_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'event_categories',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // Add indexes for event_category_assignments
    await queryInterface.addIndex('event_category_assignments', ['event_id'], {
      name: 'idx_event_category_assignment_event_id',
    });
    await queryInterface.addIndex('event_category_assignments', ['category_id'], {
      name: 'idx_event_category_assignment_category_id',
    });

    // =========================================
    // Service Configuration Table
    // =========================================

    // service_config - Service configuration
    await queryInterface.createTable('service_config', {
      parameter: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      value: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // =========================================
    // ActivityPub Tables
    // =========================================

    // ap_inbox - ActivityPub inbox messages
    await queryInterface.createTable('ap_inbox', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      message_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      message: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      processed_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      processed_status: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // ap_outbox - ActivityPub outbox messages
    await queryInterface.createTable('ap_outbox', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      message_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      message: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      processed_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      processed_status: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // ap_following - Calendars we follow
    await queryInterface.createTable('ap_following', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      remote_calendar_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      repost_policy: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'manual',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // ap_follower - Calendars following us
    await queryInterface.createTable('ap_follower', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      remote_calendar_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // ap_shared_event - Shared/reposted events
    await queryInterface.createTable('ap_shared_event', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      event_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      calendar_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // ap_event_activity - Event activities from other calendars
    await queryInterface.createTable('ap_event_activity', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      event_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      type: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      remote_calendar_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Drop tables in reverse order of creation (respecting foreign key dependencies)
    await queryInterface.dropTable('ap_event_activity');
    await queryInterface.dropTable('ap_shared_event');
    await queryInterface.dropTable('ap_follower');
    await queryInterface.dropTable('ap_following');
    await queryInterface.dropTable('ap_outbox');
    await queryInterface.dropTable('ap_inbox');
    await queryInterface.dropTable('service_config');
    await queryInterface.dropTable('event_category_assignments');
    await queryInterface.dropTable('event_category_content');
    await queryInterface.dropTable('event_categories');
    await queryInterface.dropTable('event_instance');
    await queryInterface.dropTable('event_schedule');
    await queryInterface.dropTable('event_content');
    await queryInterface.dropTable('event');
    await queryInterface.dropTable('media');
    await queryInterface.dropTable('location');
    await queryInterface.dropTable('account_invitation');
    await queryInterface.dropTable('calendar_editor');
    await queryInterface.dropTable('calendar_content');
    await queryInterface.dropTable('calendar');
    await queryInterface.dropTable('profile');
    await queryInterface.dropTable('account_application');
    await queryInterface.dropTable('account_secrets');
    await queryInterface.dropTable('account_role');
    await queryInterface.dropTable('account');
  },
};
