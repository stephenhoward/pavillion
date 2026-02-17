import { describe, it, expect, beforeEach } from 'vitest';
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
 * Note: These tests validate the committed production.yaml file and the
 * custom-environment-variables.yaml file to ensure production configuration
 * is correct.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');
const PRODUCTION_CONFIG_PATH = path.join(CONFIG_DIR, 'production.yaml');

describe('Production Configuration', () => {
  describe('production.yaml Configuration', () => {
    let productionConfig: Record<string, unknown>;

    beforeEach(() => {
      expect(fs.existsSync(PRODUCTION_CONFIG_PATH)).toBe(true);
      const content = fs.readFileSync(PRODUCTION_CONFIG_PATH, 'utf8');
      productionConfig = yaml.parse(content);
    });

    it('should provide appropriate database defaults for production', () => {
      expect(productionConfig).toHaveProperty('database');
      const dbConfig = productionConfig.database as Record<string, unknown>;

      // Should use PostgreSQL dialect in production
      expect(dbConfig.dialect).toBe('postgres');

      // Should have logging disabled for production
      expect(dbConfig.logging).toBe(false);
    });

    it('should configure mail transport for production', () => {
      expect(productionConfig).toHaveProperty('mail');
      const mailConfig = productionConfig.mail as Record<string, unknown>;

      // Should use SMTP transport in production
      expect(mailConfig.transport).toBe('smtp');
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
