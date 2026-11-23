import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { execFileSync, spawnSync } from 'child_process';

/**
 * Whether `docker compose` can run here. npm test also runs on machines
 * without Docker, so the tests that ask Compose to resolve the file are
 * skipped there; the string assertions on the raw YAML always run.
 */
const dockerComposeAvailable =
  spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;

/**
 * Returns the pavillion-backups device as `docker compose config` resolves it.
 *
 * Compose reads the shell environment before any env file, so BACKUP_HOST_DIR
 * is removed from (or set on) the child environment explicitly. `-f` and
 * `--env-file /dev/null` keep a developer's .env or docker-compose.override.yml
 * from changing the answer.
 */
function resolvedBackupsDevice(backupHostDir: string | undefined): string {
  const env = { ...process.env };
  delete env.BACKUP_HOST_DIR;
  if (backupHostDir !== undefined) {
    env.BACKUP_HOST_DIR = backupHostDir;
  }

  const output = execFileSync(
    'docker',
    ['compose', '-f', 'docker-compose.yml', '--env-file', '/dev/null', 'config'],
    { env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return parseYaml(output).volumes['pavillion-backups'].driver_opts.device;
}

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

    it('should back pavillion-backups with BACKUP_HOST_DIR, defaulting to /opt/pavillion/backups', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      expect(config.volumes['pavillion-backups'].driver_opts.device)
        .toBe('${BACKUP_HOST_DIR:-/opt/pavillion/backups}');
    });

    describe.skipIf(!dockerComposeAvailable)('resolved by docker compose config', () => {
      it('should resolve the backups device to /opt/pavillion/backups when BACKUP_HOST_DIR is unset', () => {
        expect(resolvedBackupsDevice(undefined)).toBe('/opt/pavillion/backups');
      });

      it('should resolve the backups device to BACKUP_HOST_DIR when it is set', () => {
        expect(resolvedBackupsDevice('/srv/pavillion-backups')).toBe('/srv/pavillion-backups');
      });
    });
  });

  describe('off-host backup copy settings', () => {
    const BACKUP_S3_NAMES = [
      'BACKUP_S3_BUCKET',
      'BACKUP_S3_REGION',
      'BACKUP_S3_ENDPOINT',
      'BACKUP_S3_ACCESS_KEY',
      'BACKUP_S3_SECRET_KEY',
      'BACKUP_S3_SECRET_KEY_FILE',
    ];

    function serviceEnvironment(service: string): string[] {
      const config = parseYaml(readFileSync('docker-compose.yml', 'utf-8'));
      return config.services[service].environment ?? [];
    }

    it('should default the offsite block to the s3 driver with inert values', () => {
      const defaults = parseYaml(readFileSync('config/default.yaml', 'utf-8'));
      const offsite = defaults.housekeeping.backup.offsite;
      const s3 = offsite.s3;

      // The driver names a destination type; the empty bucket keeps it off.
      expect(offsite.driver).toBe('s3');
      expect(s3.bucket).toBe('');
      expect(s3.region).toBe('us-east-1');
      expect(s3.endpoint).toBe('');
      // Credentials are environment-only; declaring them here would invite
      // putting them in config/local.yaml.
      expect(s3).not.toHaveProperty('accessKeyId');
      expect(s3).not.toHaveProperty('secretAccessKey');
    });

    it('should drop the commented-out future-enhancement s3 block', () => {
      const raw = readFileSync('config/default.yaml', 'utf-8');

      expect(raw).not.toContain('future enhancement');
      expect(raw).not.toMatch(/^\s*#\s*s3:/m);
    });

    it('should map the BACKUP_S3_* variables onto housekeeping.backup.offsite.s3', () => {
      const mapping = parseYaml(readFileSync('config/custom-environment-variables.yaml', 'utf-8'));

      expect(mapping.housekeeping.backup.offsite.s3).toEqual({
        bucket: 'BACKUP_S3_BUCKET',
        region: 'BACKUP_S3_REGION',
        endpoint: 'BACKUP_S3_ENDPOINT',
        accessKeyId: 'BACKUP_S3_ACCESS_KEY',
        secretAccessKey: 'BACKUP_S3_SECRET_KEY',
      });
    });

    it('should read BACKUP_S3_SECRET_KEY from a _FILE secret in the entrypoint', () => {
      const entrypoint = readFileSync('bin/entrypoint.sh', 'utf-8');

      expect(entrypoint).toContain('file_env \'BACKUP_S3_SECRET_KEY\'');
      expect(entrypoint).toMatch(/^#\s+- BACKUP_S3_SECRET_KEY_FILE\s+-> BACKUP_S3_SECRET_KEY$/m);
    });

    it('should pass every BACKUP_S3_* variable to the worker service', () => {
      const env = serviceEnvironment('worker');

      for (const name of BACKUP_S3_NAMES) {
        expect(env).toContain(`${name}=\${${name}:-}`);
      }
    });

    it('should not pass AWS_REQUEST_CHECKSUM_CALCULATION to the worker service, since the client pins it', () => {
      const env = serviceEnvironment('worker');

      // Guard against passing because the list failed to load.
      expect(env.length).toBeGreaterThan(0);
      expect(env.filter((entry) => entry.startsWith('AWS_REQUEST_CHECKSUM_CALCULATION'))).toEqual([]);
    });

    it('should pass no BACKUP_S3_* variable to the app service', () => {
      const env = serviceEnvironment('app');

      // Guard against passing because the list failed to load.
      expect(env.length).toBeGreaterThan(0);
      expect(env.filter((entry) => /^BACKUP_S3_/.test(entry))).toEqual([]);
    });
  });

  describe('docker-compose.yml metrics listener exposure', () => {
    /** The port the app process serves OpenMetrics on, from shipped config. */
    function configuredMetricsPort(): string {
      const defaults = parseYaml(readFileSync('config/default.yaml', 'utf-8'));
      return String(defaults.housekeeping.monitoring.metrics.port);
    }

    it('should not publish the metrics port from any service', () => {
      const config = parseYaml(readFileSync('docker-compose.yml', 'utf-8'));
      const metricsPort = configuredMetricsPort();

      // Privacy of the metrics endpoint rests on this: the listener binds
      // 0.0.0.0 inside the container so a companion monitoring container can
      // reach it, and nothing but non-publication keeps it off the host.
      const published: string[] = Object.values(config.services)
        .flatMap((service: any) => service.ports ?? [])
        .map((mapping: unknown) => String(mapping));

      // Guard against the assertion passing because nothing is published at all.
      expect(published.length).toBeGreaterThan(0);
      for (const mapping of published) {
        expect(mapping).not.toContain(metricsPort);
      }
    });

    it('should publish only the application port from the app service', () => {
      const config = parseYaml(readFileSync('docker-compose.yml', 'utf-8'));

      // The app container runs the metrics listener alongside the web server;
      // only the web port may reach the host, and by default only on loopback:
      // Docker-published ports bypass UFW, so a bare 3000 would be open to the
      // internet whatever the firewall says. APP_PORT stays the override.
      expect(config.services.app.ports).toEqual(['${APP_PORT:-127.0.0.1:3000}:3000']);
    });

    it('should not publish the metrics port from the development compose file', () => {
      const config = parseYaml(readFileSync('docker-compose.dev.yml', 'utf-8'));
      const metricsPort = configuredMetricsPort();

      const published: string[] = Object.values(config.services ?? {})
        .flatMap((service: any) => service.ports ?? [])
        .map((mapping: unknown) => String(mapping));

      for (const mapping of published) {
        expect(mapping).not.toContain(metricsPort);
      }
    });

    it('should not route the metrics path through the bundled reverse proxy', () => {
      const caddyfile = readFileSync('Caddyfile', 'utf-8');
      const metricsPort = configuredMetricsPort();

      // Standalone deployments front the app with Caddy; it must not become
      // the thing that publishes what compose deliberately withheld.
      expect(caddyfile).not.toContain('/metrics');
      expect(caddyfile).not.toContain(metricsPort);
    });
  });

  describe('docker-compose.yml autoheal service', () => {
    it('should pin the autoheal image by digest', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      expect(config.services.autoheal).toBeDefined();
      // Pinned by digest so a tag re-push of the third-party image cannot
      // silently change the binary running with Docker API access.
      expect(config.services.autoheal.image).toMatch(
        /^willfarrell\/autoheal:1\.2\.0@sha256:[0-9a-f]{64}$/,
      );
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

    it('should not mount the Docker socket into autoheal', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      // The third-party autoheal image must never touch the raw socket; it
      // reaches the Docker API through the locked-down socket-proxy instead.
      const volumes = config.services.autoheal.volumes ?? [];
      const hasDockerSocket = volumes.some((volume: string) =>
        volume.includes('/var/run/docker.sock'),
      );
      expect(hasDockerSocket).toBe(false);
    });

    it('should reach the Docker API through the socket-proxy unix socket', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      // autoheal 1.2.0 has no plain-HTTP-over-TCP mode and guards its monitor
      // loop with `[ -e "$DOCKER_SOCK" ]`, so it must be pointed at a real
      // socket file, not a tcp:// URL. It reaches the proxied API over a unix
      // socket shared with socket-proxy via the autoheal-proxy-sock volume.
      const env = config.services.autoheal.environment;
      expect(env).toContain('DOCKER_SOCK=/run/proxy/docker.sock');
      expect(env).not.toContain('DOCKER_SOCK=tcp://socket-proxy:2375');

      const volumes = config.services.autoheal.volumes ?? [];
      expect(volumes).toContain('autoheal-proxy-sock:/run/proxy');
      expect(config.volumes['autoheal-proxy-sock']).toBeDefined();
    });

    it('should wait for socket-proxy to be healthy before starting', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      // The proxied socket must exist before autoheal's `[ -e "$DOCKER_SOCK" ]`
      // guard runs, otherwise it exits 127 in a crash loop. Gate on the proxy's
      // healthcheck rather than plain ordering.
      expect(config.services.autoheal.depends_on['socket-proxy'].condition).toBe(
        'service_healthy',
      );
      expect(config.services['socket-proxy'].healthcheck).toBeDefined();
    });

    it('should set autoheal restart policy', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      expect(config.services.autoheal.restart).toBe('unless-stopped');
    });
  });

  describe('docker-compose.yml socket-proxy service', () => {
    it('should pin the proxy image by digest', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      expect(config.services['socket-proxy']).toBeDefined();
      expect(config.services['socket-proxy'].image).toMatch(
        /^haproxy:[^@]+@sha256:[0-9a-f]{64}$/,
      );
    });

    it('should mount the Docker socket read-only', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      const volumes = config.services['socket-proxy'].volumes ?? [];
      const socketMount = volumes.find((volume: string) =>
        volume.includes('/var/run/docker.sock'),
      );
      expect(socketMount).toBeDefined();
      // Read-only: a write-capable socket mount would defeat the proxy.
      expect(socketMount).toMatch(/:ro$/);
    });

    it('should be the only service that mounts the Docker socket', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      const mounters = Object.entries(config.services)
        .filter(([, svc]: [string, any]) =>
          (svc.volumes ?? []).some((volume: string) =>
            volume.includes('/var/run/docker.sock'),
          ),
        )
        .map(([name]) => name);

      expect(mounters).toEqual(['socket-proxy']);
    });

    it('should not publish a host port', () => {
      const composeContent = readFileSync('docker-compose.yml', 'utf-8');
      const config = parseYaml(composeContent);

      // Reachable only on the internal compose network, never from the host.
      expect(config.services['socket-proxy'].ports).toBeUndefined();
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

    // Operators run backups and restores as `node /app/bin/pavillion <verb>`
    // inside the worker container, so the launcher and everything it runs
    // must be in the image.
    it('should copy the CLI launcher, src and config into the production stage', () => {
      const productionStage = extractStage(readFileSync('Dockerfile', 'utf-8'), 'production');

      expect(productionStage).toMatch(/^COPY\s+bin\/pavillion\s+\.\/bin\/pavillion\s*$/m);
      expect(productionStage).toMatch(/^COPY\s.*\s\.\/src\s*$/m);
      expect(productionStage).toMatch(/^COPY\s.*\s\.\/config\s*$/m);
    });
  });

  describe('bin/pavillion', () => {
    it('should run the CLI from its TypeScript source, not from dist/', () => {
      const launcher = readFileSync('bin/pavillion', 'utf-8');

      // The production image has no compiled server under dist/; it runs
      // src/ through tsx.
      expect(launcher).toContain('src/server/cli/index.ts');
      expect(existsSync('src/server/cli/index.ts')).toBe(true);
      expect(launcher).not.toMatch(/dist\//);
    });

    it('should have tsx as a production dependency', () => {
      const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

      // The image installs with npm ci --omit=dev; the launcher spawns tsx.
      expect(pkg.dependencies.tsx).toBeDefined();
      expect(pkg.devDependencies?.tsx).toBeUndefined();
    });
  });

  describe('operator wrapper scripts', () => {
    const compose = parseYaml(readFileSync('docker-compose.yml', 'utf-8'));
    const workerContainer = compose.services.worker.container_name;

    it.each([
      'scripts/backup.sh',
      'scripts/housekeeping.sh',
      'scripts/restore-drill.sh',
    ])('%s should default PAVILLION_CONTAINER to the worker container', (script) => {
      const match = readFileSync(script, 'utf-8').match(/\$\{PAVILLION_CONTAINER:-([^}]+)\}/);

      // Backups live on the worker's volume and the worker has pg_dump.
      expect(match).not.toBeNull();
      expect(match![1]).toBe(workerContainer);
    });

    it('should mount pavillion-backups on the worker the wrappers target', () => {
      const volumes: string[] = compose.services.worker.volumes ?? [];

      expect(volumes.some((volume) => volume.startsWith('pavillion-backups:'))).toBe(true);
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
