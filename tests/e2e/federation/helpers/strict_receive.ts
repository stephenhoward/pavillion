/**
 * Strict-Receive Helper for Federation Signature Tests
 *
 * Provides a way to flip beta into strict signature-receive mode
 * (SKIP_SIGNATURES=false) for the duration of a single spec, then restore the
 * default (SKIP_SIGNATURES=true) afterwards so other federation specs are
 * unaffected.
 *
 * Why a container recreate is required:
 *   verifyHttpSignature -> shouldSkipSignatures() reads process.env.SKIP_SIGNATURES
 *   on every request (src/server/activitypub/helper/http_signature.ts:33-63).
 *   The Node process inside the container inherits its env once at boot;
 *   docker exec cannot mutate the parent process's env. The only way to flip
 *   the value is to recreate the container with the new env.
 *
 * Strategy:
 *   - Write a temporary docker-compose override file that sets the desired
 *     SKIP_SIGNATURES value on instance_beta.
 *   - `docker compose -f docker-compose.federation.yml -f <override> up -d
 *     --no-deps instance_beta` recreates beta only, leaving alpha + nginx +
 *     databases untouched.
 *   - Poll beta's /health endpoint until it is ready before returning.
 *
 * The helper is intentionally scoped to instance_beta; flipping alpha is not
 * needed for receive-side verification (alpha is the signer, beta is the
 * verifier).
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import https from 'https';
import { INSTANCE_BETA } from './instances';

// Self-signed cert tolerance for local Docker federation environment
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const COMPOSE_FILE = 'docker-compose.federation.yml';
// PID-scoped to avoid collisions when concurrent Playwright workers (or
// concurrent CI runs sharing the tmpdir) both invoke setBetaSkipSignatures.
const OVERRIDE_PATH = join(tmpdir(), `pavillion-federation-strict-receive.${process.pid}.override.yml`);

/**
 * Build a minimal docker-compose override that flips SKIP_SIGNATURES on beta.
 *
 * Note: docker compose merges environment lists by KEY=VAL prefix, so naming
 * the variable identically here replaces the value from the base compose file
 * rather than appending a second entry.
 */
function buildOverrideYaml(skipSignatures: 'true' | 'false'): string {
  return [
    'services:',
    '  instance_beta:',
    '    environment:',
    `      - SKIP_SIGNATURES=${skipSignatures}`,
    '',
  ].join('\n');
}

/**
 * Poll beta's /health endpoint until it returns 200 or the deadline elapses.
 *
 * @param timeoutMs - Maximum time to wait for beta to come back up
 * @param intervalMs - Polling interval
 * @throws Error if beta does not become healthy before the deadline
 */
export async function waitForBetaHealthy(
  timeoutMs = 60000,
  intervalMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${INSTANCE_BETA.baseUrl}/health`, {
        // @ts-ignore - agent is not in the TypeScript types but works at runtime
        agent: httpsAgent,
      });
      if (response.ok) {
        return;
      }
      lastError = new Error(`/health returned ${response.status}`);
    }
    catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `Beta did not become healthy within ${timeoutMs}ms (last error: ${String(lastError)})`,
  );
}

/**
 * Recreate the beta container with SKIP_SIGNATURES set to the requested value
 * and wait for it to become healthy.
 *
 * @param value - 'true' to bypass signature verification (default),
 *                'false' to enforce strict signature verification.
 */
export async function setBetaSkipSignatures(value: 'true' | 'false'): Promise<void> {
  // Write the override file. Always rewrite so we never trust a stale file
  // from a previous interrupted run.
  writeFileSync(OVERRIDE_PATH, buildOverrideYaml(value), 'utf8');

  // Recreate beta only. --no-deps avoids touching nginx/alpha/databases.
  // --force-recreate ensures docker actually applies the new env even if the
  // image and other config are unchanged.
  execSync(
    `docker compose -f ${COMPOSE_FILE} -f ${OVERRIDE_PATH} up -d --no-deps --force-recreate instance_beta`,
    { stdio: 'pipe' },
  );

  await waitForBetaHealthy();
}

/**
 * Restore beta to the default SKIP_SIGNATURES=true state (matching the base
 * compose file) and clean up the override file. Safe to call in afterAll even
 * if setBetaSkipSignatures was never called -- it simply recreates beta with
 * the base config.
 */
export async function restoreBetaDefaultSignatures(): Promise<void> {
  try {
    execSync(
      `docker compose -f ${COMPOSE_FILE} up -d --no-deps --force-recreate instance_beta`,
      { stdio: 'pipe' },
    );
    await waitForBetaHealthy();
  }
  finally {
    if (existsSync(OVERRIDE_PATH)) {
      try {
        unlinkSync(OVERRIDE_PATH);
      }
      catch { /* best-effort cleanup */ }
    }
  }
}
