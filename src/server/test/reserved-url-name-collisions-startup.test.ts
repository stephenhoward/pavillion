import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger so the boot-time warnings can be asserted without producing
// real output. vi.hoisted keeps the mock reference valid despite hoisting.
const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock('@/server/common/helper/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: warnMock, debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: warnMock, debug: vi.fn() }),
}));

import { reportReservedUrlNameCollisions, reportReservedUrlNameCollisionsSafely } from '@/server/server';

/**
 * Direct coverage of the startup collision report, following the convention
 * `setupHealthCheck`, `configureProxy` and `startMetricsListener` already
 * establish for this module.
 *
 * The silent-when-clean branch is the one that most needs a test: a healthy
 * instance takes it on every single boot, and a regression there would either
 * spam every operator's log or — worse, in the other direction — swallow the
 * warning that says a calendar's public page is unreachable at the site root.
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

  it('states the collision as breakage happening now, not a migration still to come', () => {
    // DEC-018 already moved public calendar URLs to the domain root, and the
    // site routes exclude a reserved first segment, so /admin answers with the
    // application shell rather than the calendar's page — today, on every
    // request. A warning written in the future tense would read as housekeeping
    // an operator can defer, which is the opposite of what they should do.
    reportReservedUrlNameCollisions([{ urlName: 'admin', reason: 'reserved_segment' }]);

    const message = warnMock.mock.calls[0][1];
    expect(message).toContain('unreachable at the site root today');
    expect(message).not.toContain('resolves normally today');
    expect(message).not.toContain('once public calendar URLs move');
  });

  it('tells the operator what still works, so the warning is not read as a lost calendar', () => {
    // DEC-018 rule 4 keeps name resolution off the reserved list: the calendar
    // still serves its actor document, answers WebFinger and receives inbox
    // deliveries. Only the human-facing page is shadowed, and an operator
    // weighing a rename against the links it breaks needs to know that.
    reportReservedUrlNameCollisions([{ urlName: 'admin', reason: 'reserved_segment' }]);

    expect(warnMock.mock.calls[0][1]).toContain('still federates');
  });

  it('logs no account or owner identifier alongside the url name', () => {
    // A calendar url name is public by definition; nothing else about the
    // calendar's people may ride along into the boot log (DEC-004).
    reportReservedUrlNameCollisions([{ urlName: 'admin', reason: 'reserved_segment' }]);

    expect(Object.keys(warnMock.mock.calls[0][0]).sort()).toEqual(['reason', 'urlName']);
  });
});

/**
 * The wrapper the boot sequence actually calls. It exists for one reason: the
 * report runs inside the database-initialization try, whose catch exits the
 * process, so an unguarded throw here would take an instance down over
 * read-only diagnostics an operator has to act on by hand anyway.
 */
describe('reportReservedUrlNameCollisionsSafely', () => {
  beforeEach(() => {
    warnMock.mockClear();
  });

  it('reports the collisions the source returns', async () => {
    await reportReservedUrlNameCollisionsSafely(
      async () => [{ urlName: 'admin', reason: 'reserved_segment' }],
    );

    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][0]).toEqual({ urlName: 'admin', reason: 'reserved_segment' });
  });

  it('does not propagate a throwing collision source', async () => {
    await expect(
      reportReservedUrlNameCollisionsSafely(async () => {
        throw new Error('relation "calendars" does not exist');
      }),
    ).resolves.toBeUndefined();
  });

  it('logs the failure as a warning rather than letting boot fail', async () => {
    const error = new Error('relation "calendars" does not exist');

    await reportReservedUrlNameCollisionsSafely(async () => {
      throw error;
    });

    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][0]).toEqual({ err: error });
  });

  it('does not propagate a synchronously throwing collision source', async () => {
    await expect(
      reportReservedUrlNameCollisionsSafely(() => {
        throw new Error('interface unavailable');
      }),
    ).resolves.toBeUndefined();
  });
});
