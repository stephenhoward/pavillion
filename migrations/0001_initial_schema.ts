import { Sequelize, DataTypes } from 'sequelize';

/**
 * Base Schema Migration
 *
 * This migration creates the complete Pavillion database schema including:
 * - Account management (accounts, invitations, applications)
 * - Calendar management (calendars, events, schedules, categories, locations)
 * - Media management
 * - ActivityPub federation (inbox, outbox, following, followers)
 * - Subscription management (OAuth provider connections)
 * - System configuration
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
      email: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      created_from_invite: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      created_from_application: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      is_activated: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      activation_timestamp: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      is_admin: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
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

    // account_invitation - Account invitations
    await queryInterface.createTable('account_invitation', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      code: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      created_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      status: {
        type: DataTypes.STRING,
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

    // calendar - User calendars
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
        onDelete: 'CASCADE',
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
      title: {
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

    // Add index on calendar_id for calendar_content
    await queryInterface.addIndex('calendar_content', ['calendar_id'], {
      name: 'idx_calendar_content_calendar_id',
    });

    // calendar_editor - Calendar editors/collaborators
    await queryInterface.createTable('calendar_editor', {
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
      email: {
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

    // Add index on calendar_id for calendar_editor
    await queryInterface.addIndex('calendar_editor', ['calendar_id'], {
      name: 'idx_calendar_editor_calendar_id',
    });

    // Add index on email for calendar_editor
    await queryInterface.addIndex('calendar_editor', ['email'], {
      name: 'idx_calendar_editor_email',
    });

    // event_category - Event categories
    await queryInterface.createTable('event_category', {
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
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // Add index on calendar_id for event_category
    await queryInterface.addIndex('event_category', ['calendar_id'], {
      name: 'idx_event_category_calendar_id',
    });

    // event_category_content - Event category content translations
    await queryInterface.createTable('event_category_content', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      category_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'event_category',
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
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // Add index on category_id for event_category_content
    await queryInterface.addIndex('event_category_content', ['category_id'], {
      name: 'idx_event_category_content_category_id',
    });

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

    // Add index on calendar_id for location
    await queryInterface.addIndex('location', ['calendar_id'], {
      name: 'idx_location_calendar_id',
    });

    // Add index on name for location search performance
    await queryInterface.addIndex('location', ['name'], {
      name: 'idx_location_name',
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
      filename: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      mime_type: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      size: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      storage_key: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      alt_text: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      is_attached_to_event: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
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

    // Add index on calendar_id for media
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
        type: DataTypes.STRING,
        allowNull: true,
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

    // Add index on calendar_id for events
    await queryInterface.addIndex('event', ['calendar_id'], {
      name: 'idx_event_calendar_id',
    });

    // Add index on location_id for efficient event-location joins
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

    // Add index on event_id for event_content
    await queryInterface.addIndex('event_content', ['event_id'], {
      name: 'idx_event_content_event_id',
    });

    // Add index on name for event_content (for search)
    await queryInterface.addIndex('event_content', ['name'], {
      name: 'idx_event_content_name',
    });

    // Add index on description for event_content (for search)
    await queryInterface.addIndex('event_content', ['description'], {
      name: 'idx_event_content_description',
    });

    // event_schedule - Event schedules
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
        defaultValue: false,
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

    // event_category_assignment - Event category assignments
    await queryInterface.createTable('event_category_assignment', {
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
      category_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'event_category',
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

    // Add composite index on event_id and category_id
    await queryInterface.addIndex('event_category_assignment', ['event_id', 'category_id'], {
      name: 'idx_event_category_assignment_event_category',
      unique: true,
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
      start: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      end: {
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

    // Add index on event_id for event_instance
    await queryInterface.addIndex('event_instance', ['event_id'], {
      name: 'idx_event_instance_event_id',
    });

    // Add index on start date for event_instance (for date range queries)
    await queryInterface.addIndex('event_instance', ['start'], {
      name: 'idx_event_instance_start',
    });

    // =========================================
    // SYSTEM CONFIGURATION
    // =========================================

    // configuration - System configuration
    await queryInterface.createTable('configuration', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      signups_open: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      applications_open: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
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
        comment: 'manual or scheduled',
      },
      category: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'daily, weekly, or monthly',
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

    // Add index on created_at for backup_metadata (for retention queries)
    await queryInterface.addIndex('backup_metadata', ['created_at'], {
      name: 'idx_backup_metadata_created_at',
    });

    // Add index on category for backup_metadata (for retention queries)
    await queryInterface.addIndex('backup_metadata', ['category'], {
      name: 'idx_backup_metadata_category',
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
    await queryInterface.createTable('ap_event_activity', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
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

    // =========================================
    // SUBSCRIPTION MANAGEMENT (OAuth)
    // =========================================

    // platform_oauth_config - Platform-level OAuth app credentials
    await queryInterface.createTable('platform_oauth_config', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      provider_type: {
        type: DataTypes.ENUM('stripe', 'paypal'),
        allowNull: false,
      },
      client_id: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Encrypted OAuth client ID',
      },
      client_secret: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Encrypted OAuth client secret',
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

    // Add index for provider_type lookup
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
        allowNull: false,
        unique: true,
        comment: '64-character hex string (32 bytes)',
      },
      provider_type: {
        type: DataTypes.ENUM('stripe', 'paypal'),
        allowNull: false,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'Token expiration timestamp (15 minutes from creation)',
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

    // Add unique index on token for fast lookup and uniqueness constraint
    await queryInterface.addIndex('oauth_state_tokens', ['token'], {
      name: 'oauth_state_tokens_token_idx',
      unique: true,
    });

    // Add index on expires_at for efficient cleanup queries
    await queryInterface.addIndex('oauth_state_tokens', ['expires_at'], {
      name: 'oauth_state_tokens_expires_at_idx',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Drop tables in reverse order of creation to handle foreign key constraints

    // Subscription management
    await queryInterface.dropTable('oauth_state_tokens');
    await queryInterface.dropTable('platform_oauth_config');

    // ActivityPub federation
    await queryInterface.dropTable('ap_event_activity');
    await queryInterface.dropTable('ap_shared_event');
    await queryInterface.dropTable('ap_follower');
    await queryInterface.dropTable('ap_following');
    await queryInterface.dropTable('ap_outbox');
    await queryInterface.dropTable('ap_inbox');

    // System configuration
    await queryInterface.dropTable('configuration');

    // Housekeeping
    await queryInterface.dropTable('backup_metadata');

    // Event management
    await queryInterface.dropTable('event_instance');
    await queryInterface.dropTable('event_category_assignment');
    await queryInterface.dropTable('event_schedule');
    await queryInterface.dropTable('event_content');
    await queryInterface.dropTable('event');

    // Media management
    await queryInterface.dropTable('media');

    // Calendar management
    await queryInterface.dropTable('location');
    await queryInterface.dropTable('event_category_content');
    await queryInterface.dropTable('event_category');
    await queryInterface.dropTable('calendar_editor');
    await queryInterface.dropTable('calendar_content');
    await queryInterface.dropTable('calendar');

    // Account management
    await queryInterface.dropTable('account_invitation');
    await queryInterface.dropTable('account_application');
    await queryInterface.dropTable('account_secrets');
    await queryInterface.dropTable('account');
  },
};
