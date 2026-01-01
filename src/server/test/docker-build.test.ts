import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Tests for Docker build verification.
 *
 * These tests verify:
 * - Dockerfile builds successfully
 * - Built image runs and responds to health check endpoint
 * - Production build includes compiled assets and migrations
 * - Container can start with required environment variables
 *
 * Note: These tests require Docker to be installed and running.
 * They are meant to be run as part of the deployment verification process.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const IMAGE_NAME = 'pavillion-test-build';
const CONTAINER_NAME = 'pavillion-test-container';

/**
 * Helper to execute command and return output.
 */
function runCommand(command: string, options: { cwd?: string; timeout?: number } = {}): string {
  try {
    return execSync(command, {
      cwd: options.cwd || PROJECT_ROOT,
      encoding: 'utf8',
      timeout: options.timeout || 300000, // 5 minute default timeout
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  catch (error: any) {
    throw new Error(`Command failed: ${command}\n${error.stderr || error.message}`);
  }
}

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
 * Helper to cleanup Docker resources.
 */
function cleanupDocker(): void {
  try {
    execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'pipe' });
  }
  catch {
    // Container might not exist
  }
  try {
    execSync(`docker rmi -f ${IMAGE_NAME}`, { stdio: 'pipe' });
  }
  catch {
    // Image might not exist
  }
}

describe('Docker Build Verification', () => {
  const dockerAvailable = isDockerAvailable();

  beforeAll(() => {
    if (!dockerAvailable) {
      console.log('Docker is not available, skipping Docker build tests');
      return;
    }
    // Clean up any previous test artifacts
    cleanupDocker();
  });

  afterAll(() => {
    if (!dockerAvailable) return;
    // Clean up test artifacts
    cleanupDocker();
  });

  describe('Dockerfile Validation', () => {
    it('should have a valid Dockerfile that can be parsed', () => {
      const dockerfilePath = path.join(PROJECT_ROOT, 'Dockerfile');
      expect(fs.existsSync(dockerfilePath)).toBe(true);

      // Read and verify basic Dockerfile structure
      const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');

      // Should have FROM statements (multi-stage build)
      expect(dockerfileContent).toMatch(/^FROM\s+node:/m);

      // Should have a production stage with slim image
      expect(dockerfileContent).toMatch(/FROM\s+node:[\d.]+-slim/);

      // Should copy the migrations directory
      expect(dockerfileContent).toMatch(/COPY.*migrations/);

      // Should set non-root user
      expect(dockerfileContent).toMatch(/USER\s+pavillion/);

      // Should have health check
      expect(dockerfileContent).toMatch(/HEALTHCHECK/);

      // Should use dumb-init for proper signal handling
      expect(dockerfileContent).toMatch(/dumb-init/);
    });

    it('should have a .dockerignore file with appropriate exclusions', () => {
      const dockerignorePath = path.join(PROJECT_ROOT, '.dockerignore');
      expect(fs.existsSync(dockerignorePath)).toBe(true);

      const content = fs.readFileSync(dockerignorePath, 'utf8');

      // Should exclude development files
      expect(content).toMatch(/node_modules/);
      expect(content).toMatch(/\.git/);
      expect(content).toMatch(/\*\.test\.ts/);
      expect(content).toMatch(/coverage/);
    });
  });

  describe.skipIf(!dockerAvailable)('Docker Image Build', () => {
    it('should build the Docker image successfully', () => {
      // Build the image with a test tag
      const output = runCommand(
        `docker build -t ${IMAGE_NAME} .`,
        { timeout: 600000 }, // 10 minute timeout for build
      );

      // Verify build completed
      expect(output).toContain('Successfully');

      // Verify image exists
      const images = runCommand(`docker images ${IMAGE_NAME} --format "{{.Repository}}"`);
      expect(images.trim()).toBe(IMAGE_NAME);
    }, 600000); // 10 minute timeout for this test

    it('should produce an image with reasonable size', () => {
      // Get image size in MB
      const sizeOutput = runCommand(
        `docker images ${IMAGE_NAME} --format "{{.Size}}"`,
      );

      // Parse size (handles formats like "500MB", "1.2GB")
      const sizeStr = sizeOutput.trim();
      let sizeInMB: number;

      if (sizeStr.includes('GB')) {
        sizeInMB = parseFloat(sizeStr) * 1024;
      }
      else if (sizeStr.includes('MB')) {
        sizeInMB = parseFloat(sizeStr);
      }
      else {
        // Assume KB or smaller
        sizeInMB = parseFloat(sizeStr) / 1024;
      }

      // Image should be less than 1.5GB (reasonable for Node.js + dependencies + tsx)
      expect(sizeInMB).toBeLessThan(1536);

      // Image should be more than 100MB (has Node.js runtime and dependencies)
      expect(sizeInMB).toBeGreaterThan(100);
    });
  });

  describe.skipIf(!dockerAvailable)('Production Build Contents', () => {
    it('should include frontend assets and migrations in the image', () => {
      // Check migrations directory exists
      const migrationsCheck = runCommand(
        `docker run --rm ${IMAGE_NAME} ls -la /app/migrations`,
      );
      expect(migrationsCheck).toContain('0001_initial_schema');

      // Check dist directory exists with built frontend assets
      const distCheck = runCommand(
        `docker run --rm ${IMAGE_NAME} ls -la /app/dist`,
      );
      expect(distCheck).toContain('.vite');

      // Check TypeScript source files exist (tsx runs them directly)
      const srcCheck = runCommand(
        `docker run --rm ${IMAGE_NAME} ls -la /app/src/server`,
      );
      expect(srcCheck).toContain('app.ts');
      expect(srcCheck).toContain('server.ts');

      // Check tsx is available for TypeScript execution
      const tsxCheck = runCommand(
        `docker run --rm ${IMAGE_NAME} npx tsx --version`,
      );
      expect(tsxCheck).toBeTruthy();
    });

    it('should not include devDependencies in the image', () => {
      // Check that node_modules doesn't include dev-only packages
      const result = runCommand(
        `docker run --rm ${IMAGE_NAME} ls /app/node_modules`,
      );

      // Should have production dependencies
      expect(result).toContain('express');
      expect(result).toContain('sequelize');
      expect(result).toContain('tsx');

      // Should NOT have dev dependencies
      expect(result).not.toContain('vitest');
      expect(result).not.toContain('@vue/test-utils');
      expect(result).not.toContain('eslint');
    });
  });

  describe.skipIf(!dockerAvailable)('Container Startup', () => {
    it('should start container with required environment variables', async () => {
      // Start container with minimal required environment
      const startCommand = `docker run -d --name ${CONTAINER_NAME} \
        -e NODE_ENV=production \
        -e DB_HOST=localhost \
        -e DB_PORT=5432 \
        -e DB_NAME=pavillion \
        -e DB_USER=pavillion \
        -e DB_PASSWORD=testpassword \
        -p 3099:3000 \
        ${IMAGE_NAME}`;

      runCommand(startCommand);

      // Wait for container to start (might exit quickly without DB)
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Check container logs for startup attempt
      const logs = runCommand(`docker logs ${CONTAINER_NAME}`);

      // Container should attempt to start (may fail due to no database)
      // but should not crash immediately with missing env var errors
      expect(logs).toContain('Production mode');

      // Clean up
      runCommand(`docker rm -f ${CONTAINER_NAME}`);
    }, 60000);
  });
});
