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
  /** Port range start for auto-allocation (default: 3100) */
  portRangeStart?: number;
  /** Port range end for auto-allocation (default: 3200) */
  portRangeEnd?: number;
  /** Timeout for server startup in ms (default: 30000) */
  startupTimeout?: number;
}

/**
 * Find an available port within the specified range
 *
 * @param startPort - Starting port number (default: 3100)
 * @param endPort - Ending port number (default: 3200)
 * @returns Promise resolving to an available port number
 */
async function findAvailablePort(
  startPort: number = 3100,
  endPort: number = 3200,
): Promise<number> {
  try {
    const port = await getPort({
      port: portNumbers(startPort, endPort),
    });
    return port;
  }
  catch (error) {
    throw new Error(
      `Failed to find available port in range ${startPort}-${endPort}: ${error}`,
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
  } = options;

  // Find an available port
  const port = requestedPort || await findAvailablePort(portRangeStart, portRangeEnd);
  const baseURL = `http://localhost:${port}`;

  console.log(`[Test Server] Starting server on port ${port}...`);

  // Spawn server process with tsx (TypeScript executor)
  // Set NODE_ENV=e2e for proper seeding and built frontend asset serving
  const serverProcess = spawn('npx', ['tsx', 'src/server/app.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'e2e',
      HOST_PORT: port.toString(),
      DB_RESET: 'true', // Ensure database reset on startup
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Buffer server output for debugging
  let serverOutput = '';
  serverProcess.stdout?.on('data', (data) => {
    serverOutput += data.toString();
  });

  serverProcess.stderr?.on('data', (data) => {
    serverOutput += data.toString();
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
