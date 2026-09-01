import { describe, it, expect, afterEach } from 'vitest';
import http, { Server } from 'http';
import { AddressInfo } from 'net';
import config from 'config';
import sinon from 'sinon';

import { startMetricsListener } from '@/server/server';
import HousekeepingInterface from '@/server/housekeeping/interface';

/**
 * Direct coverage of the metrics listener's startup contract, following the
 * convention `setupHealthCheck` and `configureProxy` already establish for
 * this module (health-endpoint.test.ts, configure-proxy.test.ts).
 *
 * Both branches matter operationally: the disabled path is how an operator
 * turns telemetry off, and the error path is what keeps a port collision from
 * taking the whole application down with an unhandled 'error' event.
 */
describe('startMetricsListener', () => {
  const sandbox = sinon.createSandbox();
  const opened: Server[] = [];

  const housekeepingInterface = {
    getOperationalMetrics: async () => ({
      backup: null, backupVolume: null, mediaVolume: null, databaseSizeBytes: 42, mediaVolume: null, queues: null,
    }),
  } as unknown as HousekeepingInterface;

  /** Stubs only the metrics config keys; everything else falls through. */
  function stubMetricsConfig(settings: { enabled: boolean, port?: number, bindAddress?: string }) {
    const realGet = config.get.bind(config);
    sandbox.stub(config, 'get').callsFake((key: any) => {
      switch (key) {
        case 'housekeeping.monitoring.metrics.enabled': return settings.enabled;
        case 'housekeeping.monitoring.metrics.port': return settings.port ?? 0;
        case 'housekeeping.monitoring.metrics.bindAddress': return settings.bindAddress ?? '127.0.0.1';
        default: return realGet(key);
      }
    });
  }

  function track(server: Server | null): Server | null {
    if (server) opened.push(server);
    return server;
  }

  async function listening(server: Server): Promise<void> {
    if (server.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }

  afterEach(async () => {
    sandbox.restore();
    while (opened.length > 0) {
      const server = opened.pop()!;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('starts nothing and returns null when metrics are disabled', () => {
    stubMetricsConfig({ enabled: false });

    const server = track(startMetricsListener(housekeepingInterface));

    expect(server).toBeNull();
  });

  it('listens on the configured address and serves the exposition', async () => {
    stubMetricsConfig({ enabled: true, port: 0, bindAddress: '127.0.0.1' });

    const server = track(startMetricsListener(housekeepingInterface))!;
    await listening(server);

    const address = server.address() as AddressInfo;
    expect(address.address).toBe('127.0.0.1');

    const body = await (await fetch(`http://127.0.0.1:${address.port}/metrics`)).text();
    expect(body).toContain('pavillion_db_size_bytes 42');
  });

  it('degrades to serving no metrics when the port is already taken', async () => {
    // Occupy a port, then point the listener at it.
    const blocker = http.createServer();
    opened.push(blocker);
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const port = (blocker.address() as AddressInfo).port;

    stubMetricsConfig({ enabled: true, port, bindAddress: '127.0.0.1' });

    const server = track(startMetricsListener(housekeepingInterface))!;

    // The registered 'error' handler is the whole point: without a listener,
    // Node throws an 'error' event and the process dies. Awaiting the event
    // here would surface that as an unhandled error and fail this test.
    const error = await new Promise<NodeJS.ErrnoException>((resolve) => {
      server.once('error', resolve);
    });

    expect(error.code).toBe('EADDRINUSE');
    expect(server.listening).toBe(false);
  });
});
