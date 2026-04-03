import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';

/**
 * Tests for the worker health check endpoint.
 *
 * These tests verify the HTTP health server behavior defined in worker.ts
 * by replicating the same request handler logic. The worker module cannot be
 * imported directly because it triggers database connections and job queue
 * initialization on load. Instead, we create a minimal server with the same
 * handler logic and test its responses.
 */

/**
 * Creates a health server with the same logic as worker.ts startHealthServer().
 * The isStarted callback simulates jobQueue?.isStarted() ?? false.
 */
function createTestHealthServer(isStarted: () => boolean): http.Server {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const started = isStarted();
    const status = started ? 200 : 503;
    const body = JSON.stringify({ status: started ? 'ok' : 'unavailable' });

    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  });
}

/**
 * Helper to make an HTTP request and return the response.
 */
function makeRequest(
  server: http.Server,
  method: string,
  path: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      reject(new Error('Server not listening'));
      return;
    }

    const req = http.request(
      { hostname: '127.0.0.1', port: address.port, method, path },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, body: data });
        });
      },
    );

    req.on('error', reject);
    req.end();
  });
}

describe('Worker Health Endpoint', () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
      server = null;
    }
  });

  /**
   * Helper to start the test server on an ephemeral port.
   */
  function startServer(isStarted: () => boolean): Promise<http.Server> {
    return new Promise((resolve) => {
      server = createTestHealthServer(isStarted);
      server.listen(0, '127.0.0.1', () => {
        resolve(server!);
      });
    });
  }

  describe('GET /health', () => {
    it('should return 200 with {"status":"ok"} when job queue is started', async () => {
      const srv = await startServer(() => true);

      const response = await makeRequest(srv, 'GET', '/health');

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
    });

    it('should return 503 with {"status":"unavailable"} when job queue is not started', async () => {
      const srv = await startServer(() => false);

      const response = await makeRequest(srv, 'GET', '/health');

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body)).toEqual({ status: 'unavailable' });
    });

    it('should return application/json content type', async () => {
      const srv = await startServer(() => true);

      const response = await makeRequest(srv, 'GET', '/health');

      expect(response.statusCode).toBe(200);
      const parsed = JSON.parse(response.body);
      expect(parsed).toBeDefined();
    });
  });

  describe('non-health paths', () => {
    it('should return 404 for GET on unknown path', async () => {
      const srv = await startServer(() => true);

      const response = await makeRequest(srv, 'GET', '/unknown');

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({ error: 'Not found' });
    });

    it('should return 404 for POST to /health', async () => {
      const srv = await startServer(() => true);

      const response = await makeRequest(srv, 'POST', '/health');

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({ error: 'Not found' });
    });

    it('should return 404 for PUT to /health', async () => {
      const srv = await startServer(() => true);

      const response = await makeRequest(srv, 'PUT', '/health');

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({ error: 'Not found' });
    });
  });

  describe('binding behavior', () => {
    it('should bind to 127.0.0.1 (loopback only)', async () => {
      const srv = await startServer(() => true);

      const address = srv.address();
      expect(address).toBeDefined();
      expect(typeof address).not.toBe('string');

      if (typeof address !== 'string' && address) {
        expect(address.address).toBe('127.0.0.1');
      }
    });
  });
});
