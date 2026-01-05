import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { countRoutes } from '../common/test/lib/express';
import sinon from 'sinon';
import express from 'express';

// Mock the server initialization module before importing main
vi.mock('../server', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

describe('Main App', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should start', async () => {
    const main = (await import('../app')).default;
    const initPavillionServer = (await import('../server')).default;

    await main(app);

    expect(vi.mocked(initPavillionServer)).toHaveBeenCalledWith(app, expect.any(Number));
  });
});
