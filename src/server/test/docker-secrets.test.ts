import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Tests for Docker secrets infrastructure.
 *
 * These tests verify:
 * - file_env function reads secret from file path
 * - file_env function exports as environment variable
 * - file_env function unsets _FILE variable after reading
 * - file_env function handles missing file gracefully
 * - Backward compatibility when _FILE var is not set
 */

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const ENTRYPOINT_PATH = path.join(PROJECT_ROOT, 'bin', 'entrypoint.sh');

describe('Docker Secrets - file_env function', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for test secret files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavillion-secrets-test-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should read secret from file path when _FILE variable is set', () => {
    // Create a secret file
    const secretPath = path.join(tempDir, 'test_secret');
    const secretValue = 'my-super-secret-value-12345';
    fs.writeFileSync(secretPath, secretValue);

    // Run file_env through bash, sourcing the entrypoint and calling the function
    // Redirect log output to stderr so we can check stdout cleanly
    const result = spawnSync('bash', ['-c', `
      source "${ENTRYPOINT_PATH}"
      # Override log functions to write to stderr for clean test output
      log_info() { echo -e "\${GREEN}[INFO]\${NC} \$1" >&2; }
      log_warn() { echo -e "\${YELLOW}[WARN]\${NC} \$1" >&2; }
      export TEST_SECRET_FILE="${secretPath}"
      file_env 'TEST_SECRET'
      echo "\${TEST_SECRET}"
    `], {
      encoding: 'utf8',
      env: { ...process.env },
    });

    // The function should read the file and output the secret value
    expect(result.stdout.trim()).toBe(secretValue);
    expect(result.status).toBe(0);
  });

  it('should export secret as environment variable', () => {
    // Create a secret file
    const secretPath = path.join(tempDir, 'jwt_secret');
    const secretValue = 'jwt-secret-abc123';
    fs.writeFileSync(secretPath, secretValue);

    // Verify the secret is exported and accessible
    const result = spawnSync('bash', ['-c', `
      source "${ENTRYPOINT_PATH}"
      # Override log functions to write to stderr for clean test output
      log_info() { echo -e "\${GREEN}[INFO]\${NC} \$1" >&2; }
      log_warn() { echo -e "\${YELLOW}[WARN]\${NC} \$1" >&2; }
      export JWT_SECRET_FILE="${secretPath}"
      file_env 'JWT_SECRET'
      # Verify JWT_SECRET is set
      if [ -n "\${JWT_SECRET}" ]; then
        echo "JWT_SECRET=\${JWT_SECRET}"
      else
        echo "JWT_SECRET not set"
      fi
    `], {
      encoding: 'utf8',
      env: { ...process.env },
    });

    expect(result.stdout.trim()).toBe(`JWT_SECRET=${secretValue}`);
    expect(result.status).toBe(0);
  });

  it('should unset _FILE variable after reading for security', () => {
    // Create a secret file
    const secretPath = path.join(tempDir, 'session_secret');
    const secretValue = 'session-secret-xyz789';
    fs.writeFileSync(secretPath, secretValue);

    // Verify the _FILE variable is unset after processing
    const result = spawnSync('bash', ['-c', `
      source "${ENTRYPOINT_PATH}"
      # Override log functions to write to stderr for clean test output
      log_info() { echo -e "\${GREEN}[INFO]\${NC} \$1" >&2; }
      log_warn() { echo -e "\${YELLOW}[WARN]\${NC} \$1" >&2; }
      export SESSION_SECRET_FILE="${secretPath}"
      file_env 'SESSION_SECRET'
      # Check if _FILE variable is now unset
      if [ -z "\${SESSION_SECRET_FILE+x}" ]; then
        echo "_FILE_UNSET"
      else
        echo "_FILE_STILL_SET=\${SESSION_SECRET_FILE}"
      fi
    `], {
      encoding: 'utf8',
      env: { ...process.env },
    });

    expect(result.stdout.trim()).toBe('_FILE_UNSET');
    expect(result.status).toBe(0);
  });

  it('should handle missing file gracefully without crashing', () => {
    const nonExistentPath = path.join(tempDir, 'nonexistent_secret');

    // The function should handle missing files gracefully (warn but not crash)
    const result = spawnSync('bash', ['-c', `
      source "${ENTRYPOINT_PATH}"
      export MISSING_SECRET_FILE="${nonExistentPath}"
      file_env 'MISSING_SECRET'
      echo "EXIT_CODE=\$?"
    `], {
      encoding: 'utf8',
      env: { ...process.env },
    });

    // Should not crash - script continues
    // Note: the function may warn but shouldn't cause fatal error
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('EXIT_CODE=0');
  });

  it('should maintain backward compatibility when _FILE var is not set', () => {
    // When no _FILE variable is set, the function should do nothing
    // and existing env var should remain unchanged
    const directValue = 'direct-db-password';

    const result = spawnSync('bash', ['-c', `
      source "${ENTRYPOINT_PATH}"
      export DB_PASSWORD="${directValue}"
      # Call file_env but DB_PASSWORD_FILE is not set
      file_env 'DB_PASSWORD'
      echo "DB_PASSWORD=\${DB_PASSWORD}"
    `], {
      encoding: 'utf8',
      env: { ...process.env },
    });

    // Original value should remain unchanged
    expect(result.stdout.trim()).toBe(`DB_PASSWORD=${directValue}`);
    expect(result.status).toBe(0);
  });
});

describe('Docker Secrets - Entrypoint Integration', () => {
  it('should have file_env function defined in bin/entrypoint.sh', () => {
    const content = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');

    // Should have the file_env function
    expect(content).toContain('file_env()');
    expect(content).toContain('file_env');
  });

  it('should call file_env for all supported secrets', () => {
    const content = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');

    // Should process all supported secrets
    expect(content).toMatch(/file_env.*DB_PASSWORD/);
    expect(content).toMatch(/file_env.*JWT_SECRET/);
    expect(content).toMatch(/file_env.*SESSION_SECRET/);
    expect(content).toMatch(/file_env.*S3_SECRET_KEY/);
    expect(content).toMatch(/file_env.*SMTP_PASSWORD/);
  });
});
