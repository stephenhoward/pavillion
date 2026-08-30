import { describe, it, expect, afterEach } from 'vitest';
import type { Application, Request, Response } from 'express';
import sinon from 'sinon';

import db from '@/server/common/entity/db';
import { setupHealthCheck } from '@/server/server';

type HealthHandler = (req: Request, res: Response) => Promise<void>;

// Minimal Express-app stand-in that records the registered /health handler, so
// the handler can be invoked directly. We avoid importing `express` into this
// test's own import graph: it trips a transform error in an unrelated
// transitive CJS dependency (isomorphic-dompurify).
function captureHealthHandler(): HealthHandler {
  let handler: HealthHandler | undefined;
  const app = {
    get: (path: string, registered: HealthHandler) => {
      if (path === '/health') {
        handler = registered;
      }
    },
  } as unknown as Application;

  setupHealthCheck(app);

  if (!handler) {
    throw new Error('setupHealthCheck did not register a GET /health handler');
  }
  return handler;
}

// Records what the handler actually sent, so assertions read the response the
// way an unauthenticated caller would.
function makeResponse() {
  const sent: { statusCode?: number, body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) {
      sent.statusCode = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      sent.body = payload;
      return this;
    },
  };
  return { res: res as unknown as Response, sent };
}

describe('GET /health', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('returns 200 with liveness only when the database is reachable', async () => {
    sandbox.stub(db, 'authenticate').resolves();
    const handler = captureHealthHandler();
    const { res, sent } = makeResponse();

    await handler({} as Request, res);

    expect(sent.statusCode).toBe(200);
    expect(sent.body?.status).toBe('healthy');
    // Exact key set: the public payload must never grow a per-check breakdown
    // or any other internal telemetry.
    expect(Object.keys(sent.body ?? {}).sort()).toEqual(['status', 'timestamp']);
  });

  it('returns 503 with liveness only when the database is unreachable', async () => {
    sandbox.stub(db, 'authenticate').rejects(new Error('connection refused'));
    const handler = captureHealthHandler();
    const { res, sent } = makeResponse();

    await handler({} as Request, res);

    expect(sent.statusCode).toBe(503);
    expect(sent.body?.status).toBe('unhealthy');
    // The failure path must not disclose which check failed either.
    expect(Object.keys(sent.body ?? {}).sort()).toEqual(['status', 'timestamp']);
  });
});
