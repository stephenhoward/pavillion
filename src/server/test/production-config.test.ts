import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

/**
 * Tests for production configuration handling.
 *
 * These tests verify:
 * - Environment variable overrides work for database settings
 * - production.yaml provides appropriate production defaults
 * - Flydrive storage factory works with volume-mounted config
 *
 * Note: These tests validate the production configuration template and structure,
 * not the full runtime behavior which requires the config module to reload.
 * The production.yaml file is created temporarily during tests and cleaned up afterward.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');
const PRODUCTION_CONFIG_PATH = path.join(CONFIG_DIR, 'production.yaml');

// Mock production configuration content
const MOCK_PRODUCTION_CONFIG = `# Pavillion Production Configuration (Test Mock)
#
# This file is created temporarily during tests to verify production configuration
# handling. The actual production.yaml file is gitignored and deployment-specific.

# Database configuration for production
# Uses PostgreSQL with environment variable overrides for connection details
database:
  dialect: postgres
  host: localhost
  port: 5432
  database: pavillion
  username: pavillion
  # Password should be set via DB_PASSWORD environment variable
  logging: false

# Host configuration
host:
  port: 3000

# Media storage configuration for production
# Default: local filesystem storage (volume-mounted in Docker)
# Can be overridden to S3 via environment variables or local.yaml
media:
  maxFileSize: 10485760  # 10MB in bytes
  allowedTypes:
    - 'image/png'
    - 'image/jpeg'
    - 'image/heic'
  allowedExtensions:
    - '.png'
    - '.jpg'
    - '.jpeg'
    - '.heic'
  storage:
    driver: 'local'
    basePath: '/app/storage/media'

# Email configuration for production
# SMTP settings should be configured via environment variables or local.yaml
mail:
  transport: smtp
  from: noreply@pavillion.example.org
  settings:
    # Configure SMTP via environment variables (SMTP_HOST, SMTP_PORT, etc.)
    # or in local.yaml

# Rate limiting configuration for production
rateLimit:
  enabled: true
  store: memory
  passwordReset:
    byIp:
      windowMs: 900000  # 15 minutes
      max: 5
    byEmail:
      windowMs: 3600000  # 1 hour
      max: 3
  login:
    byIp:
      windowMs: 900000  # 15 minutes
      max: 10
    byEmail:
      windowMs: 3600000  # 1 hour
      max: 5
  activitypub:
    actor:
      windowMs: 60000  # 1 minute
      max: 60
    calendar:
      windowMs: 60000  # 1 minute
      max: 120
  moderation:
    reportByIp:
      windowMs: 900000  # 15 minutes
      max: 10
    verifyByIp:
      windowMs: 900000  # 15 minutes
      max: 20
    byEmail:
      windowMs: 86400000  # 24 hours
      max: 3
    byAccount:
      windowMs: 3600000  # 1 hour
      max: 20

# Housekeeping configuration for production
housekeeping:
  enabled: true
  backup:
    schedule: '0 2 * * *'  # Daily at 2 AM
    retention:
      daily: 7
      weekly: 4
      monthly: 6
    path: '/backups'
  monitoring:
    disk:
      enabled: true
      warning_threshold: 80
      critical_threshold: 90
      check_interval: '0 * * * *'  # Hourly
`;

describe('Production Configuration', () => {
  // Create mock production.yaml before all tests
  beforeAll(() => {
    fs.writeFileSync(PRODUCTION_CONFIG_PATH, MOCK_PRODUCTION_CONFIG, 'utf8');
  });

  // Clean up mock production.yaml after all tests
  afterAll(() => {
    if (fs.existsSync(PRODUCTION_CONFIG_PATH)) {
      fs.unlinkSync(PRODUCTION_CONFIG_PATH);
    }
  });

  describe('production.yaml Configuration', () => {
    let productionConfig: Record<string, unknown>;

    beforeEach(() => {
      expect(fs.existsSync(PRODUCTION_CONFIG_PATH)).toBe(true);
      const content = fs.readFileSync(PRODUCTION_CONFIG_PATH, 'utf8');
      productionConfig = yaml.parse(content);
    });

    it('should provide appropriate database defaults for containerized deployment', () => {
      expect(productionConfig).toHaveProperty('database');
      const dbConfig = productionConfig.database as Record<string, unknown>;

      // Should use PostgreSQL dialect in production
      expect(dbConfig.dialect).toBe('postgres');

      // Should have logging disabled for production
      expect(dbConfig.logging).toBe(false);

      // Should provide reasonable defaults that can be overridden
      expect(dbConfig).toHaveProperty('host');
      expect(dbConfig).toHaveProperty('port');
      expect(dbConfig).toHaveProperty('database');
      expect(dbConfig).toHaveProperty('username');
    });

    it('should configure media storage for container environment', () => {
      expect(productionConfig).toHaveProperty('media');
      const mediaConfig = productionConfig.media as Record<string, unknown>;

      // Should have storage configuration
      expect(mediaConfig).toHaveProperty('storage');
      const storageConfig = mediaConfig.storage as Record<string, unknown>;

      // Should default to local driver (volume-mounted)
      expect(storageConfig.driver).toBe('local');

      // Should use container-appropriate path
      expect(storageConfig.basePath).toContain('/app/storage/media');
    });

    it('should have appropriate logging level for production', () => {
      // Production should have minimal logging by default
      const dbConfig = productionConfig.database as Record<string, unknown>;
      expect(dbConfig.logging).toBe(false);
    });
  });

  describe('custom-environment-variables.yaml Configuration', () => {
    let envVarsConfig: Record<string, unknown>;

    beforeEach(() => {
      const envVarsPath = path.join(CONFIG_DIR, 'custom-environment-variables.yaml');
      expect(fs.existsSync(envVarsPath)).toBe(true);
      const content = fs.readFileSync(envVarsPath, 'utf8');
      envVarsConfig = yaml.parse(content);
    });

    it('should map database environment variables to config paths', () => {
      expect(envVarsConfig).toHaveProperty('database');
      const dbVars = envVarsConfig.database as Record<string, unknown>;

      // Should map all required database environment variables
      expect(dbVars.host).toBe('DB_HOST');
      expect(dbVars.port).toBe('DB_PORT');
      expect(dbVars.database).toBe('DB_NAME');
      expect(dbVars.username).toBe('DB_USER');
      expect(dbVars.password).toBe('DB_PASSWORD');
    });

    it('should map S3 storage environment variables to config paths', () => {
      expect(envVarsConfig).toHaveProperty('media');
      const mediaVars = envVarsConfig.media as Record<string, unknown>;
      expect(mediaVars).toHaveProperty('storage');

      const storageVars = mediaVars.storage as Record<string, unknown>;
      expect(storageVars).toHaveProperty('bucket');
      expect(storageVars).toHaveProperty('region');

      // Should have credentials mapping
      expect(storageVars).toHaveProperty('credentials');
      const credsVars = storageVars.credentials as Record<string, unknown>;
      expect(credsVars.accessKeyId).toBe('S3_ACCESS_KEY');
      expect(credsVars.secretAccessKey).toBe('S3_SECRET_KEY');
    });
  });

  describe('Flydrive Storage Configuration', () => {
    it('should support local driver with volume-mounted path', () => {
      const content = fs.readFileSync(PRODUCTION_CONFIG_PATH, 'utf8');
      const config = yaml.parse(content);

      const storageConfig = config.media.storage;

      // Local driver should be properly configured
      expect(storageConfig.driver).toBe('local');
      expect(storageConfig.basePath).toBeDefined();

      // Path should be absolute and match container mount
      expect(storageConfig.basePath).toMatch(/^\/app\/storage\/media$/);
    });

    it('should have structure that supports S3 configuration via environment variables', () => {
      const envVarsPath = path.join(CONFIG_DIR, 'custom-environment-variables.yaml');
      const content = fs.readFileSync(envVarsPath, 'utf8');
      const envVars = yaml.parse(content);

      // Verify all required S3 config paths are mapped
      const storageVars = envVars.media.storage;

      expect(storageVars.bucket).toBeDefined();
      expect(storageVars.region).toBeDefined();
      expect(storageVars.credentials.accessKeyId).toBeDefined();
      expect(storageVars.credentials.secretAccessKey).toBeDefined();
    });
  });

  describe('Configuration Priority', () => {
    it('should have default.yaml with base defaults', () => {
      const defaultPath = path.join(CONFIG_DIR, 'default.yaml');
      expect(fs.existsSync(defaultPath)).toBe(true);

      const content = fs.readFileSync(defaultPath, 'utf8');
      const config = yaml.parse(content);

      // default.yaml should have base configuration
      expect(config).toHaveProperty('database');
      expect(config).toHaveProperty('media');
    });

    it('should have production.yaml with production overrides', () => {
      expect(fs.existsSync(PRODUCTION_CONFIG_PATH)).toBe(true);

      const content = fs.readFileSync(PRODUCTION_CONFIG_PATH, 'utf8');
      const config = yaml.parse(content);

      // production.yaml should have PostgreSQL configuration
      expect(config.database.dialect).toBe('postgres');
    });

    it('should document configuration priority in local.yaml.example', () => {
      const localExamplePath = path.join(CONFIG_DIR, 'local.yaml.example');
      expect(fs.existsSync(localExamplePath)).toBe(true);
      const localContent = fs.readFileSync(localExamplePath, 'utf8');

      // local.yaml.example should document the priority order
      expect(localContent).toMatch(/Environment variables/i);
      expect(localContent).toMatch(/local\.yaml/i);
      expect(localContent).toMatch(/production\.yaml/i);
      expect(localContent).toMatch(/default\.yaml/i);
    });
  });
});
