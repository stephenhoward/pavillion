import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Tests for the bin/setup.sh script.
 *
 * These tests verify:
 * - bin/setup.sh generates cryptographically secure secrets
 * - bin/setup.sh creates .env file with correct permissions (600)
 * - bin/setup.sh creates secrets/ directory with individual files
 * - bin/setup.sh detects existing .env and prompts for confirmation
 * - bin/setup.sh exits cleanly when user cancels overwrite
 * - bin/setup.sh requires "overwrite" string (not just "y")
 *
 * Note: Tests run in an isolated temp directory to avoid affecting the project.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SETUP_SCRIPT_PATH = path.join(PROJECT_ROOT, 'bin', 'setup.sh');

// Helper to create a test environment in a temp directory
function createTestEnvironment(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavillion-setup-test-'));
  // Copy setup.sh to temp directory
  fs.copyFileSync(SETUP_SCRIPT_PATH, path.join(tempDir, 'setup.sh'));
  fs.chmodSync(path.join(tempDir, 'setup.sh'), 0o755);
  return tempDir;
}

// Helper to clean up test environment
function cleanupTestEnvironment(tempDir: string): void {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  catch {
    // Ignore cleanup errors
  }
}

// Helper to run setup.sh with stdin input
function runSetupWithInput(
  cwd: string,
  input: string,
  timeout = 10000,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`echo "${input}" | ./setup.sh`, {
      cwd,
      encoding: 'utf8',
      timeout,
      env: { ...process.env, PATH: process.env.PATH },
    });
    return { stdout, stderr: '', exitCode: 0 };
  }
  catch (error) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: execError.stdout || '',
      stderr: execError.stderr || '',
      exitCode: execError.status || 1,
    };
  }
}

// Helper to run setup.sh without input (for fresh environment)
function runSetup(cwd: string, timeout = 10000): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync('./setup.sh', {
      cwd,
      encoding: 'utf8',
      timeout,
      env: { ...process.env, PATH: process.env.PATH },
    });
    return { stdout, stderr: '', exitCode: 0 };
  }
  catch (error) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: execError.stdout || '',
      stderr: execError.stderr || '',
      exitCode: execError.status || 1,
    };
  }
}

describe('Setup Script', () => {
  let testDir: string;

  beforeAll(() => {
    // Verify setup.sh exists
    expect(fs.existsSync(SETUP_SCRIPT_PATH)).toBe(true);
  });

  beforeEach(() => {
    testDir = createTestEnvironment();
  });

  afterEach(() => {
    cleanupTestEnvironment(testDir);
  });

  describe('Secret Generation', () => {
    it('should generate cryptographically secure secrets', () => {
      // Run setup.sh in a fresh environment
      const result = runSetup(testDir);

      // Script should complete successfully
      expect(result.exitCode).toBe(0);

      // Read the generated .env file
      const envPath = path.join(testDir, '.env');
      expect(fs.existsSync(envPath)).toBe(true);

      const envContent = fs.readFileSync(envPath, 'utf8');

      // Extract secrets from .env file
      const jwtMatch = envContent.match(/JWT_SECRET=(.+)/);
      const sessionMatch = envContent.match(/SESSION_SECRET=(.+)/);
      const dbMatch = envContent.match(/DB_PASSWORD=(.+)/);

      expect(jwtMatch).toBeTruthy();
      expect(sessionMatch).toBeTruthy();
      expect(dbMatch).toBeTruthy();

      const jwtSecret = jwtMatch![1];
      const sessionSecret = sessionMatch![1];
      const dbPassword = dbMatch![1];

      // Secrets should be base64 encoded (44 chars for 32 bytes)
      // openssl rand -base64 32 produces 44 characters
      expect(jwtSecret.length).toBeGreaterThanOrEqual(32);
      expect(sessionSecret.length).toBeGreaterThanOrEqual(32);
      expect(dbPassword.length).toBeGreaterThanOrEqual(32);

      // Secrets should all be unique
      expect(jwtSecret).not.toBe(sessionSecret);
      expect(jwtSecret).not.toBe(dbPassword);
      expect(sessionSecret).not.toBe(dbPassword);

      // Run again to verify new secrets are generated each time
      cleanupTestEnvironment(testDir);
      testDir = createTestEnvironment();
      runSetup(testDir);

      const envContent2 = fs.readFileSync(path.join(testDir, '.env'), 'utf8');
      const jwtMatch2 = envContent2.match(/JWT_SECRET=(.+)/);

      // New run should generate different secrets
      expect(jwtMatch2![1]).not.toBe(jwtSecret);
    });
  });

  describe('File Permissions', () => {
    it('should create .env file with 600 permissions', () => {
      runSetup(testDir);

      const envPath = path.join(testDir, '.env');
      expect(fs.existsSync(envPath)).toBe(true);

      const stats = fs.statSync(envPath);
      const permissions = stats.mode & 0o777;

      // 0o600 = owner read/write only
      expect(permissions).toBe(0o600);
    });
  });

  describe('Secrets Directory', () => {
    it('should create secrets/ directory with individual secret files', () => {
      runSetup(testDir);

      const secretsDir = path.join(testDir, 'secrets');
      expect(fs.existsSync(secretsDir)).toBe(true);
      expect(fs.statSync(secretsDir).isDirectory()).toBe(true);

      // Check for individual secret files
      const dbPasswordFile = path.join(secretsDir, 'db_password.txt');
      const jwtSecretFile = path.join(secretsDir, 'jwt_secret.txt');
      const sessionSecretFile = path.join(secretsDir, 'session_secret.txt');

      expect(fs.existsSync(dbPasswordFile)).toBe(true);
      expect(fs.existsSync(jwtSecretFile)).toBe(true);
      expect(fs.existsSync(sessionSecretFile)).toBe(true);

      // Each file should have 600 permissions
      expect(fs.statSync(dbPasswordFile).mode & 0o777).toBe(0o600);
      expect(fs.statSync(jwtSecretFile).mode & 0o777).toBe(0o600);
      expect(fs.statSync(sessionSecretFile).mode & 0o777).toBe(0o600);

      // File contents should match .env values
      const envContent = fs.readFileSync(path.join(testDir, '.env'), 'utf8');
      const jwtFromEnv = envContent.match(/JWT_SECRET=(.+)/)![1];
      const jwtFromFile = fs.readFileSync(jwtSecretFile, 'utf8').trim();

      expect(jwtFromFile).toBe(jwtFromEnv);
    });
  });

  describe('Existing Configuration Detection', () => {
    it('should detect existing .env and prompt for confirmation', () => {
      // Create an existing .env file
      fs.writeFileSync(path.join(testDir, '.env'), 'DB_PASSWORD=old_password\n');

      // Run setup and provide empty input (just press Enter to cancel)
      const result = runSetupWithInput(testDir, '');

      // Should show warning about existing configuration
      expect(result.stdout).toMatch(/WARNING|existing|Found/i);
      expect(result.stdout).toMatch(/\.env/);
    });

    it('should exit cleanly when user cancels overwrite', () => {
      // Create existing configuration
      const existingEnv = 'DB_PASSWORD=original_password\n';
      fs.writeFileSync(path.join(testDir, '.env'), existingEnv);
      fs.mkdirSync(path.join(testDir, 'secrets'));
      fs.writeFileSync(path.join(testDir, 'secrets', 'db_password.txt'), 'original');

      // Run setup and cancel by pressing Enter (empty input)
      const result = runSetupWithInput(testDir, '');

      // Should exit with code 0 (clean exit, not an error)
      expect(result.exitCode).toBe(0);

      // Original files should be preserved
      const currentEnv = fs.readFileSync(path.join(testDir, '.env'), 'utf8');
      expect(currentEnv).toBe(existingEnv);

      // Should show cancellation message
      expect(result.stdout).toMatch(/[Cc]ancel|not modified/);
    });

    it('should require "overwrite" string (not just "y")', () => {
      // Create existing configuration
      const existingEnv = 'DB_PASSWORD=original_password\n';
      fs.writeFileSync(path.join(testDir, '.env'), existingEnv);

      // Try with "y" - should NOT proceed
      const resultY = runSetupWithInput(testDir, 'y');
      expect(resultY.exitCode).toBe(0); // Clean exit
      let currentEnv = fs.readFileSync(path.join(testDir, '.env'), 'utf8');
      expect(currentEnv).toBe(existingEnv); // Original preserved

      // Try with "yes" - should NOT proceed
      const resultYes = runSetupWithInput(testDir, 'yes');
      expect(resultYes.exitCode).toBe(0);
      currentEnv = fs.readFileSync(path.join(testDir, '.env'), 'utf8');
      expect(currentEnv).toBe(existingEnv);

      // Try with "OVERWRITE" (wrong case) - should NOT proceed
      const resultUppercase = runSetupWithInput(testDir, 'OVERWRITE');
      expect(resultUppercase.exitCode).toBe(0);
      currentEnv = fs.readFileSync(path.join(testDir, '.env'), 'utf8');
      expect(currentEnv).toBe(existingEnv);

      // Try with "overwrite" - SHOULD proceed
      const resultOverwrite = runSetupWithInput(testDir, 'overwrite');
      expect(resultOverwrite.exitCode).toBe(0);
      currentEnv = fs.readFileSync(path.join(testDir, '.env'), 'utf8');
      expect(currentEnv).not.toBe(existingEnv); // Should be new content
      expect(currentEnv).toMatch(/JWT_SECRET=/); // Should have new secrets
    });
  });
});
