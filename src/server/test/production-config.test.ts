import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

/**
 * Tests for production configuration handling.
 *
 * These tests verify:
 * - Environment variable overrides work for database settings
 * - production.yaml provides appropriate defaults
 * - Flydrive storage factory works with volume-mounted config
 *
 * Note: These tests validate the configuration files and structure,
 * not the full runtime behavior which requires the config module to reload.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');

describe('Production Configuration', () => {
  describe('production.yaml Configuration', () => {
    let productionConfig: Record<string, unknown>;

    beforeEach(() => {
      const productionPath = path.join(CONFIG_DIR, 'production.yaml');
      expect(fs.existsSync(productionPath)).toBe(true);
      const content = fs.readFileSync(productionPath, 'utf8');
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
      const productionPath = path.join(CONFIG_DIR, 'production.yaml');
      const content = fs.readFileSync(productionPath, 'utf8');
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
      const productionPath = path.join(CONFIG_DIR, 'production.yaml');
      expect(fs.existsSync(productionPath)).toBe(true);

      const content = fs.readFileSync(productionPath, 'utf8');
      const config = yaml.parse(content);

      // production.yaml should have PostgreSQL configuration
      expect(config.database.dialect).toBe('postgres');
    });

    it('should document configuration priority in local.yaml.example', () => {
      const examplePath = path.join(CONFIG_DIR, 'local.yaml.example');
      expect(fs.existsSync(examplePath)).toBe(true);

      const content = fs.readFileSync(examplePath, 'utf8');

      // Should document the priority order
      expect(content).toMatch(/Environment variables/i);
      expect(content).toMatch(/local\.yaml/i);
      expect(content).toMatch(/production\.yaml/i);
      expect(content).toMatch(/default\.yaml/i);
    });
  });
});
