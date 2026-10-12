import { describe, it, expect } from 'vitest';
import {
  CALENDAR_URL_NAME_RE,
  isClaimableCalendarUrlName,
  isResolvableCalendarUrlName,
} from '@/common/validation/calendarUrlName';
import { RESERVED_ROUTE_SEGMENTS } from '@/common/routing/reserved-segments';

/**
 * Composition only. `isClaimableCalendarUrlName` is shape ∧ ¬reserved, and this
 * file covers the conjunction: the shape rule, the non-string guard that has to
 * short-circuit before the reservation check, the invariant that every
 * shape-valid list entry is refused, and the shape-only lookup predicate
 * exported beside it.
 *
 * How the reservation predicate itself behaves — case folding, near misses,
 * locale delegation, the list's own invariants — belongs to
 * src/common/test/routing/reserved-segments.test.ts and is not re-asserted here.
 */
describe('Calendar URL Name Validation', () => {
  describe('shape rule', () => {
    it.each([
      'legalusername',
      '9alsolegal',
      'alsolegal_',
      'my-calendar',
      'test-calendar-name',
      'my_test-calendar',
    ])('accepts %s', (name) => {
      expect(isClaimableCalendarUrlName(name)).toBe(true);
    });

    it.each([
      '_noleadunderscore',
      'thisisamuchtoolongusername',
      'no spaces allowed',
      'illegal@character',
      '-noleadhyphen',
      'notrailinghyphen-',
      '-bothinvalid-',
      'ab',
      '',
    ])('rejects %o', (name) => {
      expect(isClaimableCalendarUrlName(name)).toBe(false);
    });
  });

  describe('non-string input', () => {
    // Callers hand this untrusted request bodies (CalendarService.createCalendar,
    // SeriesService.createSeries), where a JSON number or array coerces past the
    // regex and would throw inside the reservation check's toLowerCase(). It has
    // to answer false, not blow up into a 500.
    it.each([
      [12345],
      [['admin']],
      [{}],
      [null],
      [undefined],
      [true],
    ])('rejects %o without throwing', (value) => {
      expect(() => isClaimableCalendarUrlName(value as unknown as string)).not.toThrow();
      expect(isClaimableCalendarUrlName(value as unknown as string)).toBe(false);
    });
  });

  describe('reserved route segments', () => {
    it.each(['admin', 'discover', 'view', 'health', 'api', 'widget'])(
      'rejects the reserved segment %s',
      (name) => {
        expect(isClaimableCalendarUrlName(name)).toBe(false);
      },
    );

    it('rejects every shape-valid entry in the reserved list', () => {
      // Entries the shape rule already rejects ('.well-known') are excluded so
      // this asserts the reservation check specifically, not the charset one.
      const shapeValid = RESERVED_ROUTE_SEGMENTS.filter((s) => CALENDAR_URL_NAME_RE.test(s));

      expect(shapeValid.length).toBeGreaterThan(0);
      for (const segment of shapeValid) {
        expect(isClaimableCalendarUrlName(segment)).toBe(false);
      }
    });
  });

  describe('isResolvableCalendarUrlName', () => {
    const shapeValidReservedSegments = RESERVED_ROUTE_SEGMENTS.filter((s) => CALENDAR_URL_NAME_RE.test(s));

    // Swap the two predicates and one half of this assertion fails.
    it.each(shapeValidReservedSegments)(
      'resolves the reserved segment %s that it may not claim',
      (segment) => {
        expect(isResolvableCalendarUrlName(segment)).toBe(true);
        expect(isClaimableCalendarUrlName(segment)).toBe(false);
      },
    );

    it.each(['no spaces allowed', '-noleadhyphen', 'notrailinghyphen-', 'ab', ''])(
      'rejects the malformed name %o',
      (name) => {
        expect(isResolvableCalendarUrlName(name)).toBe(false);
      },
    );

    it.each([
      [12345],
      [['admin']],
      [{}],
      [null],
      [undefined],
      [true],
    ])('rejects %o without throwing', (value) => {
      expect(() => isResolvableCalendarUrlName(value as unknown as string)).not.toThrow();
      expect(isResolvableCalendarUrlName(value as unknown as string)).toBe(false);
    });
  });
});
