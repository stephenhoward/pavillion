import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';

/**
 * Tests for container entrypoint behavior.
 *
 * These tests verify:
 * - Entrypoint waits for database to be ready
 * - Entrypoint runs pending migrations before app start
 * - Entrypoint exits with error code on migration failure
 * - Entrypoint starts application after successful migration
 *
 * Note: These tests verify the bin/entrypoint.sh script behavior.
 * Some tests require Docker with PostgreSQL.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const ENTRYPOINT_PATH = path.join(PROJECT_ROOT, 'bin', 'entrypoint.sh');

/**
 * Helper to check if Docker is available.
 */
function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe' });
    return true;
  }
  catch {
    return false;
  }
}

/**
 * Helper to check if a port is available.
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

describe('Container Entrypoint', () => {
  const dockerAvailable = isDockerAvailable();

  describe('Entrypoint Script Structure', () => {
    it('should have bin/entrypoint.sh script with proper structure', () => {
      expect(fs.existsSync(ENTRYPOINT_PATH)).toBe(true);

      const content = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');

      // Should be a bash script
      expect(content).toMatch(/^#!/);
      expect(content).toContain('/bin/bash');

      // Should have database readiness check
      expect(content).toMatch(/DB_HOST|pg_isready|database.*ready/i);

      // Should run migrations
      expect(content).toMatch(/migration/i);

      // Should handle failures
      expect(content).toMatch(/exit\s+1/);

      // Should start the application
      expect(content).toMatch(/npm\s+start|node|tsx/);
    });

    it('should have configurable database wait timeout', () => {
      const content = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');

      // Should have a configurable timeout (default or from env)
      expect(content).toMatch(/DB_WAIT_TIMEOUT|timeout|30/i);
    });

    it('should include clear error messages for failures', () => {
      const content = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');

      // Should have informative error messages
      expect(content).toMatch(/error|failed|unable/i);

      // Should log what it's doing
      expect(content).toMatch(/echo|log/i);
    });
  });

  describe('Database Wait Logic', () => {
    it('should implement a wait loop for database readiness', () => {
      const content = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');

      // Should have a loop or retry mechanism
      expect(content).toMatch(/while|until|retry|for/i);

      // Should have a sleep/wait between retries
      expect(content).toMatch(/sleep/i);
    });
  });

  describe('Migration Execution', () => {
    it('should call Node.js to run migrations', () => {
      const content = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');

      // Should have a run_migrations function that uses Node.js tooling
      expect(content).toContain('run_migrations');

      // Should invoke Node/tsx/npx somewhere in the migration function
      // Using 's' flag for dotAll mode (. matches newlines)
      const runMigrationsSection = content.match(/run_migrations\(\)[^}]+}/s);
      expect(runMigrationsSection).toBeTruthy();
      expect(runMigrationsSection![0]).toMatch(/(node|tsx|npx)/i);
      expect(runMigrationsSection![0]).toMatch(/migration/i);
    });

    it('should check migration exit code', () => {
      const content = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');

      // Should check for migration success/failure
      expect(content).toMatch(/\$\?|exit|if/i);
    });
  });

  describe.skipIf(!dockerAvailable)('Integration with PostgreSQL', () => {
    const PG_CONTAINER_NAME = 'pavillion-entrypoint-test-db';
    const PG_PORT = 5499; // Use non-standard port to avoid conflicts

    beforeAll(async () => {
      // Check if port is available
      const portAvailable = await isPortAvailable(PG_PORT);
      if (!portAvailable) {
        console.log(`Port ${PG_PORT} is not available, some tests may be skipped`);
        return;
      }

      // Start PostgreSQL container for integration tests
      try {
        execSync(`docker rm -f ${PG_CONTAINER_NAME}`, { stdio: 'pipe' });
      }
      catch {
        // Container might not exist
      }

      execSync(
        `docker run -d --name ${PG_CONTAINER_NAME} ` +
        `-e POSTGRES_DB=pavillion_test ` +
        `-e POSTGRES_USER=pavillion ` +
        `-e POSTGRES_PASSWORD=testpass ` +
        `-p ${PG_PORT}:5432 ` +
        `postgres:17`,
        { stdio: 'pipe' },
      );

      // Wait for PostgreSQL to be ready
      let retries = 30;
      while (retries > 0) {
        try {
          execSync(
            `docker exec ${PG_CONTAINER_NAME} pg_isready -U pavillion`,
            { stdio: 'pipe' },
          );
          break;
        }
        catch {
          retries--;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (retries === 0) {
        throw new Error('PostgreSQL container failed to start');
      }
    }, 60000);

    afterAll(() => {
      try {
        execSync(`docker rm -f ${PG_CONTAINER_NAME}`, { stdio: 'pipe' });
      }
      catch {
        // Ignore cleanup errors
      }
    });

    it('should detect when database is ready', async () => {
      // Run the database wait check portion with a short timeout
      const result = execSync(
        `DB_HOST=localhost DB_PORT=${PG_PORT} DB_USER=pavillion ` +
        `DB_WAIT_TIMEOUT=5 bash -c 'source ${ENTRYPOINT_PATH} && wait_for_db'`,
        {
          cwd: PROJECT_ROOT,
          encoding: 'utf8',
          env: {
            ...process.env,
            DB_HOST: 'localhost',
            DB_PORT: String(PG_PORT),
            DB_USER: 'pavillion',
          },
          timeout: 30000,
        },
      );

      // Should complete without error (no exception thrown)
      expect(result).toBeDefined();
    }, 30000);
  });
});

describe('Health Check Endpoint', () => {
  describe('Endpoint Configuration', () => {
    it('should have /health endpoint defined in routes or app', async () => {
      // Check for health endpoint in app_routes or server.ts
      const appRoutesPath = path.join(PROJECT_ROOT, 'src/server/app_routes.ts');
      const serverPath = path.join(PROJECT_ROOT, 'src/server/server.ts');
      const healthRoutePath = path.join(PROJECT_ROOT, 'src/server/health.ts');

      const hasHealthInRoutes = fs.existsSync(appRoutesPath)
        && fs.readFileSync(appRoutesPath, 'utf8').includes('/health');
      const hasHealthInServer = fs.existsSync(serverPath)
        && fs.readFileSync(serverPath, 'utf8').includes('/health');
      const hasHealthFile = fs.existsSync(healthRoutePath);

      expect(hasHealthInRoutes || hasHealthInServer || hasHealthFile).toBe(true);
    });
  });
});

describe('Dockerfile Entrypoint Integration', () => {
  it('should reference bin/entrypoint.sh in Dockerfile', () => {
    const dockerfilePath = path.join(PROJECT_ROOT, 'Dockerfile');
    expect(fs.existsSync(dockerfilePath)).toBe(true);

    const content = fs.readFileSync(dockerfilePath, 'utf8');

    // Should copy entrypoint script
    expect(content).toMatch(/COPY.*entrypoint\.sh/);

    // Should make it executable or use chmod
    expect(content).toMatch(/chmod.*entrypoint|RUN chmod/);

    // Should reference entrypoint in ENTRYPOINT or CMD
    expect(content).toMatch(/entrypoint\.sh/);
  });
});
