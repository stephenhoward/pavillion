import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';

/**
 * Test suite for Docker configuration files.
 *
 * These tests verify that the Docker Compose configuration and entrypoint script
 * are correctly set up for the web/worker architecture.
 */

/**
 * Returns the body of a named multi-stage build target from a Dockerfile.
 * The body runs from the matching FROM ... AS <name> line up to (but not
 * including) the next FROM line, or end of file.
 */
function extractStage(dockerfile: string, stageName: string): string {
  const startPattern = new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${stageName}\\b`, 'mi');
  const startMatch = dockerfile.match(startPattern);
  if (!startMatch || startMatch.index === undefined) {
    throw new Error(`Stage "${stageName}" not found in Dockerfile`);
  }

  const after = dockerfile.slice(startMatch.index + startMatch[0].length);
  const nextStageMatch = after.match(/^FROM\s+/m);
  return nextStageMatch && nextStageMatch.index !== undefined
    ? after.slice(0, nextStageMatch.index)
    : after;
}

describe('Docker Configuration', () => {
  describe('docker-compose.yml', () => {
    it('should include both app and worker services', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      expect(config.services).toBeDefined();
      expect(config.services.app).toBeDefined();
      expect(config.services.worker).toBeDefined();
    });

    it('should configure worker service with --worker flag', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      const workerCommand = config.services.worker.command;
      expect(workerCommand).toBeDefined();
      expect(workerCommand).toContain('--worker');
    });

    it('should configure log rotation for all services', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      // Check app service logging
      expect(config.services.app.logging).toBeDefined();
      expect(config.services.app.logging.options).toBeDefined();
      expect(config.services.app.logging.options['max-size']).toBe('10m');
      expect(config.services.app.logging.options['max-file']).toBe('5');

      // Check worker service logging
      expect(config.services.worker.logging).toBeDefined();
      expect(config.services.worker.logging.options).toBeDefined();
      expect(config.services.worker.logging.options['max-size']).toBe('10m');
      expect(config.services.worker.logging.options['max-file']).toBe('5');
    });

    it('should mount backup volume to worker container', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      const workerVolumes = config.services.worker.volumes;
      expect(workerVolumes).toBeDefined();

      const hasBackupVolume = workerVolumes.some((volume: string) =>
        volume.includes('/backups') || volume.includes('pavillion-backups'),
      );
      expect(hasBackupVolume).toBe(true);
    });

    it('should define pavillion-backups named volume', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      expect(config.volumes).toBeDefined();
      expect(config.volumes['pavillion-backups']).toBeDefined();
    });
  });

  describe('docker-compose.yml autoheal service', () => {
    it('should include autoheal service with pinned image version', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      expect(config.services.autoheal).toBeDefined();
      expect(config.services.autoheal.image).toBe('willfarrell/autoheal:1.2.0');
    });

    it('should configure autoheal environment variables', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      const env = config.services.autoheal.environment;
      expect(env).toBeDefined();
      expect(env).toContain('AUTOHEAL_CONTAINER_LABEL=autoheal');
      expect(env).toContain('AUTOHEAL_INTERVAL=30');
      expect(env).toContain('AUTOHEAL_START_PERIOD=120');
    });

    it('should mount Docker socket for autoheal', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      const volumes = config.services.autoheal.volumes;
      expect(volumes).toBeDefined();

      const hasDockerSocket = volumes.some((volume: string) =>
        volume.includes('/var/run/docker.sock'),
      );
      expect(hasDockerSocket).toBe(true);
    });

    it('should set autoheal restart policy', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      expect(config.services.autoheal.restart).toBe('unless-stopped');
    });
  });

  describe('docker-compose.yml autoheal labels', () => {
    it('should set autoheal=true label on app service', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      const labels = config.services.app.labels;
      expect(labels).toBeDefined();
      expect(labels).toContain('autoheal=true');
    });

    it('should set autoheal=true label on worker service', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      const labels = config.services.worker.labels;
      expect(labels).toBeDefined();
      expect(labels).toContain('autoheal=true');
    });
  });

  describe('docker-compose.yml worker healthcheck', () => {
    it('should have a healthcheck block on the worker service', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      const healthcheck = config.services.worker.healthcheck;
      expect(healthcheck).toBeDefined();
    });

    it('should configure worker healthcheck to query port 3001', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      const healthcheck = config.services.worker.healthcheck;
      const testCmd = Array.isArray(healthcheck.test)
        ? healthcheck.test.join(' ')
        : healthcheck.test;

      expect(testCmd).toContain('3001');
      expect(testCmd).toContain('/health');
    });

    it('should configure worker healthcheck timing parameters', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      const healthcheck = config.services.worker.healthcheck;
      expect(healthcheck.interval).toBeDefined();
      expect(healthcheck.timeout).toBeDefined();
      expect(healthcheck.retries).toBeGreaterThanOrEqual(1);
      expect(healthcheck.start_period).toBeDefined();
    });
  });

  describe('Dockerfile production stage', () => {
    // The worker container runs the production stage and must include the
    // postgres client binaries (pg_dump/pg_restore) for backup:daily to succeed.
    // Without this, the job throws "spawn pg_dump ENOENT" every night.
    it('should install postgresql-client in the production stage', () => {
      const dockerfile = readFileSync('Dockerfile', 'utf-8');
      const productionStage = extractStage(dockerfile, 'production');

      expect(productionStage).toMatch(/postgresql-client-\d+/);
    });

    it('should install a postgresql-client major version matching the postgres server', () => {
      const dockerfile = readFileSync('Dockerfile', 'utf-8');
      const compose = parseYaml(readFileSync('docker-compose.yml', 'utf-8'));

      const productionStage = extractStage(dockerfile, 'production');
      const clientVersionMatch = productionStage.match(/postgresql-client-(\d+)/);
      expect(clientVersionMatch).not.toBeNull();
      const clientMajor = clientVersionMatch![1];

      const dbImage = compose.services.db.image as string;
      const dbVersionMatch = dbImage.match(/postgres:(\d+)/);
      expect(dbVersionMatch).not.toBeNull();
      const dbMajor = dbVersionMatch![1];

      expect(clientMajor).toBe(dbMajor);
    });
  });

  describe('bin/entrypoint.sh', () => {
    it('should detect --worker argument in command', () => {
      const entrypointContent = readFileSync('bin/entrypoint.sh', 'utf-8');

      // Check that entrypoint handles worker mode detection
      expect(entrypointContent).toContain('--worker');
    });

    it('should have worker-specific logic path', () => {
      const entrypointContent = readFileSync('bin/entrypoint.sh', 'utf-8');

      // The entrypoint should have conditional logic for worker mode
      // This is a basic check - the actual logic will be in the updated file
      expect(entrypointContent).toContain('worker');
    });
  });
});
