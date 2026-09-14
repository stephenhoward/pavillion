import { describe, it, expect } from 'vitest';
import { CALENDAR_URL_NAME_RE, isValidCalendarUrlName } from '@/common/validation/calendarUrlName';
import { RESERVED_ROUTE_SEGMENTS, isReservedRouteSegment } from '@/common/routing/reserved-segments';

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
      expect(isValidCalendarUrlName(name)).toBe(true);
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
      expect(isValidCalendarUrlName(name)).toBe(false);
    });
  });

  describe('reserved route segments', () => {
    it.each(['admin', 'discover', 'view', 'health', 'api', 'widget'])(
      'rejects the reserved segment %s',
      (name) => {
        expect(isValidCalendarUrlName(name)).toBe(false);
      },
    );

    it('rejects a reserved segment regardless of case', () => {
      expect(isValidCalendarUrlName('Admin')).toBe(false);
      expect(isValidCalendarUrlName('ADMIN')).toBe(false);
    });

    it('rejects every shape-valid entry in the reserved list', () => {
      // Entries the shape rule already rejects ('.well-known') are excluded so
      // this asserts the reservation check specifically, not the charset one.
      const shapeValid = RESERVED_ROUTE_SEGMENTS.filter((s) => CALENDAR_URL_NAME_RE.test(s));

      expect(shapeValid.length).toBeGreaterThan(0);
      for (const segment of shapeValid) {
        expect(isValidCalendarUrlName(segment)).toBe(false);
      }
    });

    it.each(['admins', 'viewpoint', 'my-admin', 'healthy'])(
      'leaves the near-miss name %s available',
      (name) => {
        expect(isValidCalendarUrlName(name)).toBe(true);
      },
    );

    it('reserves supported locale codes', () => {
      // Every currently supported locale code is two characters, so the shape
      // rule rejects it before the reservation check is consulted. The
      // reservation is what would catch a longer code added later.
      expect(isReservedRouteSegment('es')).toBe(true);
      expect(isValidCalendarUrlName('es')).toBe(false);
    });
  });

  describe('CALENDAR_URL_NAME_RE', () => {
    // Exported separately for callers that must accept names an instance may
    // legitimately have issued before reservation existed — see the follow
    // lookup in ActivityPubService.normalizeIdentifier.
    it('matches a reserved name, because it tests shape only', () => {
      expect(CALENDAR_URL_NAME_RE.test('admin')).toBe(true);
      expect(CALENDAR_URL_NAME_RE.test('discover')).toBe(true);
    });

    it('still rejects malformed names', () => {
      expect(CALENDAR_URL_NAME_RE.test('no spaces allowed')).toBe(false);
      expect(CALENDAR_URL_NAME_RE.test('-noleadhyphen')).toBe(false);
    });
  });
});
