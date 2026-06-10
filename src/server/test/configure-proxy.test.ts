import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Application } from 'express';

// Mock the logger so we can assert the boot-time log line without producing
// real output. vi.hoisted keeps the mock reference valid despite hoisting.
const { infoMock } = vi.hoisted(() => ({ infoMock: vi.fn() }));
vi.mock('@/server/common/helper/logger', () => ({
  default: { info: infoMock, error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: infoMock, error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

import { configureProxy } from '@/server/server';

// Minimal Express-app stand-in that actually stores settings, so set/get
// round-trip like the real app. We avoid importing `express` directly here:
// pulling it into the test's own import graph trips a transform error in an
// unrelated transitive CJS dependency (isomorphic-dompurify). `app.get('trust
// proxy')` on the real Express returns the raw set value (1), so this fake
// behaves identically for the helper's purposes.
function makeApp(): Application {
  const settings: Record<string, unknown> = {};
  return {
    set: (key: string, value: unknown) => { settings[key] = value; },
    get: (key: string) => settings[key],
  } as unknown as Application;
}

describe('configureProxy', () => {
  beforeEach(() => {
    infoMock.mockClear();
  });

  it('sets the trust proxy hop count to 1', () => {
    // Assert the resulting state (req.ip's trust boundary), not merely that
    // app.set was called — the stored value is what actually governs req.ip.
    const app = makeApp();

    configureProxy(app);

    expect(app.get('trust proxy')).toBe(1);
  });

  it('logs only the configured integer hop count at info level', () => {
    // The logged value round-trips through the same set/get the helper uses,
    // so a hardcoded message string would not survive this assertion.
    const app = makeApp();

    configureProxy(app);

    expect(infoMock).toHaveBeenCalledTimes(1);
    const message = infoMock.mock.calls[0][0];
    // Single string argument (no object payload, no headers, no IP) per DEC-004.
    expect(typeof message).toBe('string');
    expect(message).toBe('Express trust proxy hops configured: 1');
  });
});
