import { ChildProcess, spawn } from 'child_process';
import getPort, { portNumbers } from 'get-port';
import axios from 'axios';

/**
 * Test environment configuration returned by startTestServer
 */
export interface TestEnvironment {
  /** Base URL for the test server (e.g., http://localhost:3124) */
  baseURL: string;
  /** Port number the server is listening on */
  port: number;
  /** Child process running the server */
  process: ChildProcess;
  /** Cleanup function to stop server */
  cleanup: () => Promise<void>;
}

/**
 * Options for starting a test server
 */
export interface TestServerOptions {
  /** Specific port to use (auto-allocated if not specified) */
  port?: number;
  /**
   * Port range start for auto-allocation (default: 3100). Each Playwright
   * worker allocates from its own disjoint slice of the range — see
   * workerPortSlice.
   */
  portRangeStart?: number;
  /** Port range end for auto-allocation (default: 3200) */
  portRangeEnd?: number;
  /** Timeout for server startup in ms (default: 30000) */
  startupTimeout?: number;
  /**
   * Extra environment variables to merge into the child process' env.
   * Used by specs that need to toggle env-gated behavior (e.g. the
   * ICS-import e2e spec sets ALLOW_LOCALHOST_ICS_IMPORT=true and
   * provides a NODE_CONFIG override pointing DoH at a local mock server).
   * Values here take precedence over the caller's process.env.
   */
  extraEnv?: Record<string, string>;
}

/**
 * Number of ports reserved for each Playwright worker within a port range.
 *
 * A worker runs one test server at a time (beforeAll/afterAll), so the extra
 * ports are headroom for sockets still releasing between spec files and for
 * orphaned servers left by a crashed worker whose replacement reuses the
 * same parallel index.
 */
const PORTS_PER_WORKER = 10;

/**
 * Restrict a port range to the slice owned by the current Playwright worker.
 *
 * Playwright's `TEST_PARALLEL_INDEX` is unique among concurrently running
 * workers (a replacement worker reuses the index of the worker it replaced,
 * never one held by a live worker), so slicing the range by that index makes
 * it impossible for two workers to select the same port: their candidate
 * ranges are disjoint by construction. This closes the check-then-bind race
 * where two workers both saw port 3100 as free and both handed it to their
 * server process.
 *
 * Outside a Playwright worker (no `TEST_PARALLEL_INDEX`) the first slice is
 * used.
 */
function workerPortSlice(
  startPort: number,
  endPort: number,
): { start: number; end: number } {
  const rawIndex = Number(process.env.TEST_PARALLEL_INDEX);
  const workerIndex = Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : 0;

  const start = startPort + workerIndex * PORTS_PER_WORKER;
  const end = Math.min(start + PORTS_PER_WORKER - 1, endPort);

  if (start > endPort) {
    throw new Error(
      `Port range ${startPort}-${endPort} has no slice for worker index ${workerIndex} `
      + `(${PORTS_PER_WORKER} ports per worker). Widen the range or lower the worker count.`,
    );
  }

  return { start, end };
}

/**
 * Find an available port within the current worker's slice of the range
 *
 * @param startPort - Starting port number of the full range (default: 3100)
 * @param endPort - Ending port number of the full range (default: 3200)
 * @returns Promise resolving to an available port number
 */
async function findAvailablePort(
  startPort: number = 3100,
  endPort: number = 3200,
): Promise<number> {
  const { start, end } = workerPortSlice(startPort, endPort);

  try {
    const port = await getPort({
      port: portNumbers(start, end),
    });
    return port;
  }
  catch (error) {
    throw new Error(
      `Failed to find available port in range ${start}-${end}: ${error}`,
    );
  }
}

/**
 * Wait for server to be ready by polling the health endpoint
 *
 * @param baseURL - Base URL of the server
 * @param timeout - Maximum time to wait in milliseconds
 */
async function waitForServerReady(baseURL: string, timeout: number = 30000): Promise<void> {
  const startTime = Date.now();
  const healthUrl = `${baseURL}/health`;

  while (Date.now() - startTime < timeout) {
    try {
      const response = await axios.get(healthUrl, { timeout: 1000 });
      if (response.status === 200) {
        console.log(`[Test Server] Ready at ${baseURL}`);
        return;
      }
    }
    catch (error) {
      // Server not ready yet, continue polling
    }

    // Wait 100ms before next attempt
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`Server at ${baseURL} did not become ready within ${timeout}ms`);
}

/**
 * Start an isolated test server with its own database and port
 *
 * This function creates a completely isolated test environment:
 * - Fresh in-memory SQLite database
 * - Unique port allocation
 * - Independent configuration
 * - Seeded with test data
 *
 * The server runs as a child process, similar to Playwright's webServer option,
 * but isolated per test file.
 *
 * Example usage:
 * ```typescript
 * let env: TestEnvironment;
 *
 * test.beforeAll(async () => {
 *   env = await startTestServer();
 * });
 *
 * test.afterAll(async () => {
 *   await env.cleanup();
 * });
 *
 * test('my test', async ({ page }) => {
 *   await page.goto(env.baseURL + '/calendar');
 *   // test logic
 * });
 * ```
 *
 * @param options - Configuration options for the test server
 * @returns Promise resolving to TestEnvironment with server details and cleanup function
 */
export async function startTestServer(
  options: TestServerOptions = {},
): Promise<TestEnvironment> {
  const {
    port: requestedPort,
    portRangeStart = 3100,
    portRangeEnd = 3200,
    startupTimeout = 30000,
    extraEnv = {},
  } = options;

  // Find an available port
  const port = requestedPort || await findAvailablePort(portRangeStart, portRangeEnd);
  const baseURL = `http://localhost:${port}`;

  console.log(`[Test Server] Starting server on port ${port}...`);

  // Spawn server process with tsx (TypeScript executor)
  // Set NODE_ENV=e2e for proper seeding and built frontend asset serving.
  //
  // NODE_OPTIONS: `--unhandled-rejections=warn` keeps the child alive when
  // a promise rejects without a handler. The e2e backend exercises many
  // async background workers (ActivityPub outbox processor, etc.) whose
  // rejected promises are only logged — not re-thrown — in production
  // under Pino. Newer Node defaults to `throw`, which would crash the
  // test server mid-test and surface as a flaky ERR_CONNECTION_REFUSED
  // with no useful diagnostic. Warning-only matches production operators'
  // experience and lets the tests assert what they came to assert.
  const nodeOptions = [process.env.NODE_OPTIONS, '--unhandled-rejections=warn']
    .filter(Boolean)
    .join(' ');

  const serverProcess = spawn('npx', ['tsx', 'src/server/app.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'e2e',
      HOST_PORT: port.toString(),
      DB_RESET: 'true', // Ensure database reset on startup
      NODE_OPTIONS: nodeOptions,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Buffer server output for debugging
  let serverOutput = '';
  serverProcess.stdout?.on('data', (data) => {
    const s = data.toString();
    serverOutput += s;
    if (process.env.TEST_SERVER_VERBOSE === '1') {
      process.stdout.write(`[server:${port}] ${s}`);
    }
  });

  serverProcess.stderr?.on('data', (data) => {
    const s = data.toString();
    serverOutput += s;
    if (process.env.TEST_SERVER_VERBOSE === '1') {
      process.stderr.write(`[server:${port} err] ${s}`);
    }
  });

  // Handle process errors
  const processError = new Promise<never>((_, reject) => {
    serverProcess.on('error', (error) => {
      reject(new Error(`Failed to start server process: ${error.message}`));
    });

    serverProcess.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        reject(new Error(
          `Server process exited with code ${code}. Output:\n${serverOutput}`,
        ));
      }
    });
  });

  // Wait for server to be ready (race against process errors)
  try {
    await Promise.race([
      waitForServerReady(baseURL, startupTimeout),
      processError,
    ]);
  }
  catch (error) {
    // Kill process if startup failed
    serverProcess.kill();
    throw error;
  }

  // Create cleanup function
  const cleanup = async () => {
    console.log(`[Test Server] Shutting down server on port ${port}...`);

    // Kill the server process
    serverProcess.kill('SIGTERM');

    // Wait for process to exit (with timeout)
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[Test Server] Process did not exit gracefully, forcing kill...');
        serverProcess.kill('SIGKILL');
        resolve();
      }, 5000);

      serverProcess.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    console.log(`[Test Server] Cleanup complete for port ${port}`);
  };

  return {
    baseURL,
    port,
    process: serverProcess,
    cleanup,
  };
}

/**
 * Helper to start multiple test servers for advanced testing scenarios
 *
 * @param count - Number of servers to start
 * @param options - Options for each server
 * @returns Promise resolving to array of TestEnvironments
 */
export async function startMultipleTestServers(
  count: number,
  options: TestServerOptions = {},
): Promise<TestEnvironment[]> {
  const servers: TestEnvironment[] = [];

  for (let i = 0; i < count; i++) {
    const server = await startTestServer(options);
    servers.push(server);
  }

  return servers;
}
