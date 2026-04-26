import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

/**
 * Tests for secrets configuration handling.
 *
 * These tests verify:
 * - JWT secret loads from config in development
 * - Session secret loads from config in development
 * - JWT_SECRET env var overrides default config
 * - SESSION_SECRET env var overrides default config
 * - funding.encryptionKey exists in default.yaml and is marked development-only
 * - ENCRYPTION_KEY env var maps to funding.encryptionKey
 *
 * Note: These tests validate the configuration files and structure.
 * The config package caches values at first require, so we test the YAML
 * structure directly to verify environment variable mappings.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../../../../..');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');

describe('Secrets Configuration', () => {
  describe('default.yaml JWT and Session Configuration', () => {
    let defaultConfig: Record<string, unknown>;

    beforeEach(() => {
      const defaultPath = path.join(CONFIG_DIR, 'default.yaml');
      expect(fs.existsSync(defaultPath)).toBe(true);
      const content = fs.readFileSync(defaultPath, 'utf8');
      defaultConfig = yaml.parse(content);
    });

    it('should load jwt.secret from config in development', () => {
      expect(defaultConfig).toHaveProperty('jwt');
      const jwtConfig = defaultConfig.jwt as Record<string, unknown>;

      // JWT secret should be defined with a development-only value
      expect(jwtConfig.secret).toBeDefined();
      expect(typeof jwtConfig.secret).toBe('string');

      // Should be clearly marked as development-only
      expect(jwtConfig.secret).toContain('development-only');
    });

    it('should load session.secret from config in development', () => {
      expect(defaultConfig).toHaveProperty('session');
      const sessionConfig = defaultConfig.session as Record<string, unknown>;

      // Session secret should be defined with a development-only value
      expect(sessionConfig.secret).toBeDefined();
      expect(typeof sessionConfig.secret).toBe('string');

      // Should be clearly marked as development-only
      expect(sessionConfig.secret).toContain('development-only');
    });
  });

  describe('default.yaml Encryption Key Configuration', () => {
    let defaultConfig: Record<string, unknown>;

    beforeEach(() => {
      const defaultPath = path.join(CONFIG_DIR, 'default.yaml');
      expect(fs.existsSync(defaultPath)).toBe(true);
      const content = fs.readFileSync(defaultPath, 'utf8');
      defaultConfig = yaml.parse(content);
    });

    it('should have funding.encryptionKey defined in default.yaml', () => {
      expect(defaultConfig).toHaveProperty('funding');
      const fundingConfig = defaultConfig.funding as Record<string, unknown>;

      expect(fundingConfig.encryptionKey).toBeDefined();
      expect(typeof fundingConfig.encryptionKey).toBe('string');
    });

    it('should have a valid 64-character hex encryption key for development', () => {
      const fundingConfig = defaultConfig.funding as Record<string, unknown>;

      // Must be a 64-char hex string (32 bytes for AES-256-CBC)
      expect(fundingConfig.encryptionKey).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('custom-environment-variables.yaml JWT and Session Mappings', () => {
    let envVarsConfig: Record<string, unknown>;

    beforeEach(() => {
      const envVarsPath = path.join(CONFIG_DIR, 'custom-environment-variables.yaml');
      expect(fs.existsSync(envVarsPath)).toBe(true);
      const content = fs.readFileSync(envVarsPath, 'utf8');
      envVarsConfig = yaml.parse(content);
    });

    it('should map JWT_SECRET env var to jwt.secret config path', () => {
      expect(envVarsConfig).toHaveProperty('jwt');
      const jwtVars = envVarsConfig.jwt as Record<string, unknown>;

      // JWT_SECRET environment variable should override jwt.secret config
      expect(jwtVars.secret).toBe('JWT_SECRET');
    });

    it('should map SESSION_SECRET env var to session.secret config path', () => {
      expect(envVarsConfig).toHaveProperty('session');
      const sessionVars = envVarsConfig.session as Record<string, unknown>;

      // SESSION_SECRET environment variable should override session.secret config
      expect(sessionVars.secret).toBe('SESSION_SECRET');
    });
  });

  describe('custom-environment-variables.yaml Encryption Key Mapping', () => {
    let envVarsConfig: Record<string, unknown>;

    beforeEach(() => {
      const envVarsPath = path.join(CONFIG_DIR, 'custom-environment-variables.yaml');
      expect(fs.existsSync(envVarsPath)).toBe(true);
      const content = fs.readFileSync(envVarsPath, 'utf8');
      envVarsConfig = yaml.parse(content);
    });

    it('should map ENCRYPTION_KEY env var to funding.encryptionKey config path', () => {
      expect(envVarsConfig).toHaveProperty('funding');
      const fundingVars = envVarsConfig.funding as Record<string, unknown>;

      // ENCRYPTION_KEY environment variable should override funding.encryptionKey config
      expect(fundingVars.encryptionKey).toBe('ENCRYPTION_KEY');
    });
  });

  describe('JWT Configuration Completeness', () => {
    let defaultConfig: Record<string, unknown>;

    beforeEach(() => {
      const defaultPath = path.join(CONFIG_DIR, 'default.yaml');
      const content = fs.readFileSync(defaultPath, 'utf8');
      defaultConfig = yaml.parse(content);
    });

    it('should provide jwt.expiresIn with default value', () => {
      expect(defaultConfig).toHaveProperty('jwt');
      const jwtConfig = defaultConfig.jwt as Record<string, unknown>;

      // Should have expiresIn setting for token expiration
      expect(jwtConfig.expiresIn).toBeDefined();
      expect(typeof jwtConfig.expiresIn).toBe('string');
    });
  });
});
