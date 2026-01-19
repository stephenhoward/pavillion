import { describe, it, expect } from 'vitest';
import config from 'config';

/**
 * Worker Startup and Configuration Integration Test
 *
 * Tests that configuration values are correctly loaded and available
 * for worker initialization.
 *
 * Workflow: Config Load → Values Available → Worker Can Initialize
 */
describe('Worker Startup and Configuration Integration', () => {
  it('should use configuration values for backup retention policy', () => {
    const retentionConfig = {
      daily: config.get<number>('housekeeping.backup.retention.daily'),
      weekly: config.get<number>('housekeeping.backup.retention.weekly'),
      monthly: config.get<number>('housekeeping.backup.retention.monthly'),
    };

    // Verify GFS retention configuration
    expect(retentionConfig.daily).toBe(7);
    expect(retentionConfig.weekly).toBe(4);
    expect(retentionConfig.monthly).toBe(6);

    // Total expected backups: 7 + 4 + 6 = 17
    const totalExpected = retentionConfig.daily + retentionConfig.weekly + retentionConfig.monthly;
    expect(totalExpected).toBe(17);
  });

  it('should use configuration values for disk monitoring thresholds', () => {
    const monitoringConfig = {
      enabled: config.get<boolean>('housekeeping.monitoring.disk.enabled'),
      warning: config.get<number>('housekeeping.monitoring.disk.warning_threshold'),
      critical: config.get<number>('housekeeping.monitoring.disk.critical_threshold'),
    };

    // Verify disk monitoring configuration
    expect(monitoringConfig.enabled).toBe(true);
    expect(monitoringConfig.warning).toBe(80);
    expect(monitoringConfig.critical).toBe(90);

    // Verify critical threshold is higher than warning
    expect(monitoringConfig.critical).toBeGreaterThan(monitoringConfig.warning);
  });

  it('should use configuration value for backup storage path', () => {
    const backupPath = config.get<string>('housekeeping.backup.path');

    // Verify backup path configuration
    expect(backupPath).toBe('/backups');
    expect(backupPath).toMatch(/^\/[a-zA-Z0-9_-]+$/);
  });

  it('should use configuration values for scheduled job timing', () => {
    const scheduleConfig = {
      backup: config.get<string>('housekeeping.backup.schedule'),
      diskCheck: config.get<string>('housekeeping.monitoring.disk.check_interval'),
    };

    // Verify cron expression configuration
    expect(scheduleConfig.backup).toBe('0 2 * * *'); // Daily at 2 AM
    expect(scheduleConfig.diskCheck).toBe('0 * * * *'); // Hourly

    // Verify format is valid cron expression
    expect(scheduleConfig.backup).toMatch(/^[\d\s*\/,-]+$/);
    expect(scheduleConfig.diskCheck).toMatch(/^[\d\s*\/,-]+$/);
  });

  it('should start worker in correct mode based on configuration', () => {
    const housekeepingEnabled = config.get<boolean>('housekeeping.enabled');

    // Verify housekeeping is enabled by default
    expect(housekeepingEnabled).toBe(true);
  });

  it('should have database configuration available', () => {
    // Database config uses 'database' key in config
    const dbDialect = config.get<string>('database.dialect');

    // Verify database configuration exists
    expect(dbDialect).toBeDefined();
    expect(['sqlite', 'postgres']).toContain(dbDialect);
  });

  it('should load email configuration for alert notifications', () => {
    const emailConfig = {
      from: config.get<string>('mail.from'),
      transport: config.get<string>('mail.transport'),
    };

    // Verify email configuration exists
    expect(emailConfig.from).toBeDefined();
    expect(emailConfig.from).toMatch(/^.+@.+\..+$/); // Basic email format

    expect(emailConfig.transport).toBeDefined();
    expect(['smtp', 'ses', 'testing', 'test']).toContain(emailConfig.transport);
  });

  it('should validate configuration completeness for housekeeping domain', () => {
    // Verify all required configuration keys exist
    const requiredConfig = {
      'housekeeping.enabled': config.get<boolean>('housekeeping.enabled'),
      'housekeeping.backup.schedule': config.get<string>('housekeeping.backup.schedule'),
      'housekeeping.backup.path': config.get<string>('housekeeping.backup.path'),
      'housekeeping.backup.retention.daily': config.get<number>('housekeeping.backup.retention.daily'),
      'housekeeping.backup.retention.weekly': config.get<number>('housekeeping.backup.retention.weekly'),
      'housekeeping.backup.retention.monthly': config.get<number>('housekeeping.backup.retention.monthly'),
      'housekeeping.monitoring.disk.enabled': config.get<boolean>('housekeeping.monitoring.disk.enabled'),
      'housekeeping.monitoring.disk.warning_threshold': config.get<number>('housekeeping.monitoring.disk.warning_threshold'),
      'housekeeping.monitoring.disk.critical_threshold': config.get<number>('housekeeping.monitoring.disk.critical_threshold'),
      'housekeeping.monitoring.disk.check_interval': config.get<string>('housekeeping.monitoring.disk.check_interval'),
    };

    // Verify all config values are defined
    Object.entries(requiredConfig).forEach(([key, value]) => {
      expect(value).toBeDefined();
      expect(value).not.toBeNull();
    });
  });
});
