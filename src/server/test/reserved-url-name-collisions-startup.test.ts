import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger so the boot-time warnings can be asserted without producing
// real output. vi.hoisted keeps the mock reference valid despite hoisting.
const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock('@/server/common/helper/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: warnMock, debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: warnMock, debug: vi.fn() }),
}));

import { reportReservedUrlNameCollisions } from '@/server/server';

/**
 * Direct coverage of the startup collision report, following the convention
 * `setupHealthCheck`, `configureProxy` and `startMetricsListener` already
 * establish for this module.
 *
 * The silent-when-clean branch is the one that most needs a test: a healthy
 * instance takes it on every single boot, and a regression there would either
 * spam every operator's log or — worse, in the other direction — swallow the
 * warning that says a calendar has gone unreachable at the site root.
 */
describe('reportReservedUrlNameCollisions', () => {
  beforeEach(() => {
    warnMock.mockClear();
  });

  it('logs nothing at all when no calendar collides', () => {
    reportReservedUrlNameCollisions([]);

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('warns once per collision', () => {
    reportReservedUrlNameCollisions([
      { urlName: 'admin', reason: 'reserved_segment' },
      { urlName: 'es', reason: 'locale_code' },
      { urlName: 'view', reason: 'reserved_segment' },
    ]);

    expect(warnMock).toHaveBeenCalledTimes(3);
    expect(warnMock.mock.calls.map(call => call[0].urlName)).toEqual(['admin', 'es', 'view']);
  });

  it('carries the url name and a reserved-segment reason into the log fields', () => {
    reportReservedUrlNameCollisions([{ urlName: 'admin', reason: 'reserved_segment' }]);

    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][0]).toEqual({ urlName: 'admin', reason: 'reserved_segment' });
  });

  it('carries a locale-code reason through unchanged rather than re-deriving it', () => {
    // The classification belongs to the calendar domain; this function must
    // relay whatever it is given, so the log can never disagree with the rule.
    reportReservedUrlNameCollisions([{ urlName: 'es', reason: 'locale_code' }]);

    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][0]).toEqual({ urlName: 'es', reason: 'locale_code' });
  });

  it('tells the operator to rename the calendar in its settings', () => {
    reportReservedUrlNameCollisions([{ urlName: 'admin', reason: 'reserved_segment' }]);

    const message = warnMock.mock.calls[0][1];
    expect(typeof message).toBe('string');
    expect(message).toContain('unreachable at the site root');
    expect(message).toContain('rename it in the calendar\'s settings');
  });

  it('logs no account or owner identifier alongside the url name', () => {
    // A calendar url name is public by definition; nothing else about the
    // calendar's people may ride along into the boot log (DEC-004).
    reportReservedUrlNameCollisions([{ urlName: 'admin', reason: 'reserved_segment' }]);

    expect(Object.keys(warnMock.mock.calls[0][0]).sort()).toEqual(['reason', 'urlName']);
  });
});
