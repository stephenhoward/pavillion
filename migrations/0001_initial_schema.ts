import { Sequelize, DataTypes } from 'sequelize';

/**
 * Base Schema Migration
 *
 * This migration creates the complete Pavillion database schema including:
 * - Account management (accounts, roles, secrets, invitations, applications)
 * - Calendar management (calendars, content, members, events, schedules,
 *   categories, locations, instances, reposts)
 * - Media management
 * - ActivityPub federation (inbox, outbox, following, followers, shared events,
 *   event activities, calendar actors, user actors, event objects)
 * - Moderation (reports, escalations, event reporters, blocked instances,
 *   blocked reporters)
 * - Subscription management (settings, subscriptions, events, provider configs,
 *   OAuth state tokens, platform OAuth configs)
 * - Housekeeping (backup metadata)
 * - System configuration (service config)
 *
 * Tables are created in FK-dependency order: independent tables first,
 * then tables that reference them.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // =========================================
    // ACCOUNT MANAGEMENT
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
      email: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      language: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      display_name: {
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

    // account_role - Account roles
    await queryInterface.createTable('account_role', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
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

    // =========================================
    // CALENDAR MANAGEMENT
    // =========================================

    // calendar - Calendars (no account_id - ownership via calendar_member)
    await queryInterface.createTable('calendar', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
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
      widget_allowed_domain: {
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

    // calendar_content - Calendar content translations
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

    // =========================================
    // ACTIVITYPUB ACTORS (needed before calendar_member)
    // =========================================

    // user_actor - ActivityPub Person actors (local and remote)
    await queryInterface.createTable('user_actor', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      actor_type: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'local',
      },
      account_id: {
        type: DataTypes.UUID,
        allowNull: true,
        unique: true,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      actor_uri: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      remote_username: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      remote_domain: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      public_key: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      private_key: {
        type: DataTypes.TEXT,
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

    await queryInterface.addIndex('user_actor', ['remote_domain'], {
      name: 'user_actor_remote_domain',
    });

    // calendar_actor - ActivityPub Group actors (local and remote)
    await queryInterface.createTable('calendar_actor', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      actor_type: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'local',
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: true,
        unique: true,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      actor_uri: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      remote_display_name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      remote_domain: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      inbox_url: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      shared_inbox_url: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      last_fetched: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      public_key: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      private_key: {
        type: DataTypes.TEXT,
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

    await queryInterface.addIndex('calendar_actor', ['remote_domain'], {
      name: 'calendar_actor_remote_domain',
    });

    // calendar_member - Unified calendar ownership and editor relationships
    // Uses underscored: true -> created_at/updated_at
    await queryInterface.createTable('calendar_member', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
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
      calendar_actor_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'calendar_actor',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      role: {
        type: DataTypes.STRING,
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
        onDelete: 'CASCADE',
      },
      user_actor_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'user_actor',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      granted_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      can_review_reports: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
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

    await queryInterface.addIndex('calendar_member', ['calendar_id'], {
      name: 'calendar_member_calendar_id',
    });
    await queryInterface.addIndex('calendar_member', ['calendar_actor_id'], {
      name: 'calendar_member_calendar_actor_id',
    });
    await queryInterface.addIndex('calendar_member', ['account_id'], {
      name: 'calendar_member_account_id',
    });
    await queryInterface.addIndex('calendar_member', ['user_actor_id'], {
      name: 'calendar_member_user_actor_id',
    });
    await queryInterface.addIndex('calendar_member', ['calendar_id', 'account_id'], {
      unique: true,
      name: 'unique_calendar_member_account',
    });
    await queryInterface.addIndex('calendar_member', ['calendar_id', 'user_actor_id'], {
      unique: true,
      name: 'unique_calendar_member_actor',
    });
    await queryInterface.addIndex('calendar_member', ['calendar_actor_id', 'account_id'], {
      unique: true,
      name: 'unique_remote_calendar_member_account',
    });

    // account_invitation - Account invitations
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

    await queryInterface.addIndex('account_invitation', ['calendar_id'], {
      name: 'account_invitation_calendar_id',
    });

    // =========================================
    // LOCATION MANAGEMENT
    // =========================================

    // location - Event locations
    await queryInterface.createTable('location', {
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

    await queryInterface.addIndex('location', ['calendar_id'], {
      name: 'idx_location_calendar_id',
    });
    await queryInterface.addIndex('location', ['name'], {
      name: 'idx_location_name',
    });

    // location_content - Location accessibility translations (no timestamps)
    await queryInterface.createTable('location_content', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      location_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'location',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      language: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      accessibility_info: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    });

    // =========================================
    // MEDIA MANAGEMENT
    // =========================================

    // media - Media files
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

    await queryInterface.addIndex('media', ['calendar_id'], {
      name: 'idx_media_calendar_id',
    });

    // =========================================
    // EVENT MANAGEMENT
    // =========================================

    // event - Calendar events
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
        onDelete: 'SET NULL',
      },
      location_id: {
        type: DataTypes.UUID,
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

    await queryInterface.addIndex('event', ['calendar_id'], {
      name: 'idx_event_calendar_id',
    });
    await queryInterface.addIndex('event', ['location_id'], {
      name: 'idx_event_location_id',
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

    await queryInterface.addIndex('event_content', ['event_id'], {
      name: 'idx_event_content_event_id',
    });
    await queryInterface.addIndex('event_content', ['name'], {
      name: 'idx_event_content_name',
    });
    await queryInterface.addIndex('event_content', ['description'], {
      name: 'idx_event_content_description',
    });

    // event_schedule - Event schedules (frequency is STRING not INTEGER)
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
        type: DataTypes.STRING,
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
        defaultValue: false,
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

    // event_categories (plural table name) - Event categories
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
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('event_categories', ['calendar_id'], {
      name: 'idx_event_categories_calendar_id',
    });

    // event_category_content - Event category content translations (no timestamps)
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

    await queryInterface.addIndex('event_category_content', ['category_id'], {
      name: 'idx_event_category_content_category_id',
    });

    // event_category_assignments (plural table name, no updatedAt)
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
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('event_category_assignments', ['event_id'], {
      name: 'idx_event_category_assignment_event_id',
    });
    await queryInterface.addIndex('event_category_assignments', ['category_id'], {
      name: 'idx_event_category_assignment_category_id',
    });

    // event_instance - Event instances (for recurring events)
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

    await queryInterface.addIndex('event_instance', ['event_id'], {
      name: 'idx_event_instance_event_id',
    });
    await queryInterface.addIndex('event_instance', ['start_time'], {
      name: 'idx_event_instance_start_time',
    });

    // event_repost - Event reposts (no updatedAt)
    await queryInterface.createTable('event_repost', {
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
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('event_repost', ['event_id'], {
      name: 'idx_event_repost_event_id',
    });
    await queryInterface.addIndex('event_repost', ['calendar_id'], {
      name: 'idx_event_repost_calendar_id',
    });

    // =========================================
    // ACTIVITYPUB FEDERATION
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
        onDelete: 'CASCADE',
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
        onDelete: 'CASCADE',
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

    // ap_following - Calendars this instance is following
    // PK is STRING, calendar_actor_id is UUID FK
    await queryInterface.createTable('ap_following', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      calendar_actor_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'calendar_actor',
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
      auto_repost_originals: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      auto_repost_reposts: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
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

    // ap_follower - Calendars following this instance
    // PK is STRING, calendar_actor_id is UUID FK
    await queryInterface.createTable('ap_follower', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      calendar_actor_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'calendar_actor',
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
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // ap_shared_event - Events that have been shared/reposted
    // PK is STRING, no FKs (all STRING columns)
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
      auto_posted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
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

    // ap_event_activity - Activity on events
    // No explicit @PrimaryKey - Sequelize auto-creates integer id
    await queryInterface.createTable('ap_event_activity', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      event_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      type: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      calendar_actor_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'calendar_actor',
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

    // ap_event_object - ActivityPub event object identity tracking
    await queryInterface.createTable('ap_event_object', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      event_id: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
      },
      ap_id: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      attributed_to: {
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

    await queryInterface.addIndex('ap_event_object', ['event_id'], {
      name: 'idx_event_object_event_id',
    });
    await queryInterface.addIndex('ap_event_object', ['ap_id'], {
      name: 'idx_event_object_ap_id',
    });
    await queryInterface.addIndex('ap_event_object', ['attributed_to'], {
      name: 'idx_event_object_attributed_to',
    });

    // =========================================
    // MODERATION
    // =========================================

    // report - Event reports (underscored: true -> created_at/updated_at)
    await queryInterface.createTable('report', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      event_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      category: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      reporter_email_hash: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      reporter_account_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      reporter_type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      ip_hash: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      ip_subnet: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      ip_region: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      admin_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      admin_priority: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      admin_deadline: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      admin_notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      owner_notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      reviewer_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      reviewer_notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      reviewer_timestamp: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      verification_token: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      verification_expiration: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      escalation_type: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      forwarded_from_instance: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      forwarded_report_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      forward_status: {
        type: DataTypes.ENUM('pending', 'acknowledged', 'no_response'),
        allowNull: true,
      },
      has_source_flooding_pattern: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      has_event_targeting_pattern: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      has_instance_pattern: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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

    await queryInterface.addIndex('report', ['verification_token'], {
      name: 'report_verification_token',
    });

    // report_escalation - Report escalation history
    // (underscored: true, timestamps: false + @CreatedAt created_at)
    await queryInterface.createTable('report_escalation', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      report_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      from_status: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      to_status: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      reviewer_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      reviewer_role: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      decision: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    });

    // event_reporter - Reporter tracking for duplicate prevention
    // (underscored: true, timestamps: false + @CreatedAt created_at)
    await queryInterface.createTable('event_reporter', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      event_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      reporter_identifier: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      report_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    });

    await queryInterface.addIndex('event_reporter', ['event_id', 'reporter_identifier'], {
      unique: true,
      name: 'unique_event_reporter',
    });

    // blocked_instance - Blocked ActivityPub instances
    // (underscored: true, timestamps: false)
    await queryInterface.createTable('blocked_instance', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      domain: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      blocked_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      blocked_by: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
    });

    // blocked_reporter - Blocked reporter email addresses
    // (underscored: true, timestamps: false)
    await queryInterface.createTable('blocked_reporter', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      email_hash: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      blocked_by: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // =========================================
    // SUBSCRIPTION MANAGEMENT
    // =========================================

    // subscription_settings - Instance subscription configuration
    await queryInterface.createTable('subscription_settings', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: true,
      },
      monthly_price: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      yearly_price: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      currency: {
        type: DataTypes.STRING(3),
        defaultValue: 'USD',
        allowNull: true,
      },
      pay_what_you_can: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: true,
      },
      grace_period_days: {
        type: DataTypes.INTEGER,
        defaultValue: 7,
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

    // provider_config - Payment provider configurations
    await queryInterface.createTable('provider_config', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      provider_type: {
        type: DataTypes.ENUM('stripe', 'paypal'),
        allowNull: true,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: true,
      },
      display_name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      credentials: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      webhook_secret: {
        type: DataTypes.TEXT,
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

    // user_subscription - User subscriptions
    await queryInterface.createTable('user_subscription', {
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
        onDelete: 'CASCADE',
      },
      provider_config_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'provider_config',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      provider_subscription_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      provider_customer_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('active', 'past_due', 'suspended', 'cancelled'),
        defaultValue: 'active',
        allowNull: true,
      },
      billing_cycle: {
        type: DataTypes.ENUM('monthly', 'yearly'),
        allowNull: true,
      },
      amount: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: true,
      },
      current_period_start: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      current_period_end: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelled_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      suspended_at: {
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

    // subscription_event - Subscription event log
    await queryInterface.createTable('subscription_event', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      subscription_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'user_subscription',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      event_type: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      provider_event_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      payload: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      processed_at: {
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

    // platform_oauth_config - Platform-level OAuth app credentials
    await queryInterface.createTable('platform_oauth_config', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      provider_type: {
        type: DataTypes.ENUM('stripe', 'paypal'),
        allowNull: true,
      },
      client_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      client_secret: {
        type: DataTypes.TEXT,
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

    await queryInterface.addIndex('platform_oauth_config', ['provider_type'], {
      name: 'platform_oauth_config_provider_type_idx',
    });

    // oauth_state_tokens - Temporary CSRF protection tokens
    await queryInterface.createTable('oauth_state_tokens', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      token: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      provider_type: {
        type: DataTypes.ENUM('stripe', 'paypal'),
        allowNull: true,
      },
      expires_at: {
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

    await queryInterface.addIndex('oauth_state_tokens', ['token'], {
      name: 'oauth_state_tokens_token_idx',
      unique: true,
    });
    await queryInterface.addIndex('oauth_state_tokens', ['expires_at'], {
      name: 'oauth_state_tokens_expires_at_idx',
    });

    // =========================================
    // SYSTEM CONFIGURATION
    // =========================================

    // service_config - System configuration (PK is parameter STRING, not id UUID)
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
    // HOUSEKEEPING
    // =========================================

    // backup_metadata - Database backup tracking
    await queryInterface.createTable('backup_metadata', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      filename: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      size_bytes: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      category: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      verified: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      storage_location: {
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

    await queryInterface.addIndex('backup_metadata', ['created_at'], {
      name: 'idx_backup_metadata_created_at',
    });
    await queryInterface.addIndex('backup_metadata', ['category'], {
      name: 'idx_backup_metadata_category',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Drop tables in reverse creation order to handle foreign key constraints

    // Housekeeping
    await queryInterface.dropTable('backup_metadata');

    // System configuration
    await queryInterface.dropTable('service_config');

    // Subscription management
    await queryInterface.dropTable('oauth_state_tokens');
    await queryInterface.dropTable('platform_oauth_config');
    await queryInterface.dropTable('subscription_event');
    await queryInterface.dropTable('user_subscription');
    await queryInterface.dropTable('provider_config');
    await queryInterface.dropTable('subscription_settings');

    // Moderation
    await queryInterface.dropTable('blocked_reporter');
    await queryInterface.dropTable('blocked_instance');
    await queryInterface.dropTable('event_reporter');
    await queryInterface.dropTable('report_escalation');
    await queryInterface.dropTable('report');

    // ActivityPub federation
    await queryInterface.dropTable('ap_event_object');
    await queryInterface.dropTable('ap_event_activity');
    await queryInterface.dropTable('ap_shared_event');
    await queryInterface.dropTable('ap_follower');
    await queryInterface.dropTable('ap_following');
    await queryInterface.dropTable('ap_outbox');
    await queryInterface.dropTable('ap_inbox');

    // Event management
    await queryInterface.dropTable('event_repost');
    await queryInterface.dropTable('event_instance');
    await queryInterface.dropTable('event_category_assignments');
    await queryInterface.dropTable('event_category_content');
    await queryInterface.dropTable('event_categories');
    await queryInterface.dropTable('event_schedule');
    await queryInterface.dropTable('event_content');
    await queryInterface.dropTable('event');

    // Media management
    await queryInterface.dropTable('media');

    // Location management
    await queryInterface.dropTable('location_content');
    await queryInterface.dropTable('location');

    // Calendar management
    await queryInterface.dropTable('account_invitation');
    await queryInterface.dropTable('calendar_member');
    await queryInterface.dropTable('calendar_content');

    // ActivityPub actors (before calendar since calendar_actor references calendar)
    await queryInterface.dropTable('calendar_actor');
    await queryInterface.dropTable('user_actor');

    // Calendar
    await queryInterface.dropTable('calendar');

    // Account management
    await queryInterface.dropTable('account_application');
    await queryInterface.dropTable('account_secrets');
    await queryInterface.dropTable('account_role');
    await queryInterface.dropTable('account');
  },
};
