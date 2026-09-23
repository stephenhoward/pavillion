import { describe, it, expect } from 'vitest';
import { CALENDAR_VIEW_MODES, isCalendarViewMode } from '@/common/model/calendar_view';

describe('CalendarViewMode', () => {
  describe('CALENDAR_VIEW_MODES', () => {
    it('enumerates the allowed view modes in switcher order', () => {
      expect(CALENDAR_VIEW_MODES).toEqual(['list', 'week', 'month']);
    });
  });

  describe('isCalendarViewMode', () => {
    it('accepts every enumerated view mode', () => {
      for (const mode of CALENDAR_VIEW_MODES) {
        expect(isCalendarViewMode(mode)).toBe(true);
      }
    });

    it('rejects strings outside the allowed set', () => {
      expect(isCalendarViewMode('day')).toBe(false);
      expect(isCalendarViewMode('agenda')).toBe(false);
      expect(isCalendarViewMode('')).toBe(false);
    });

    it('rejects values differing only in case', () => {
      expect(isCalendarViewMode('LIST')).toBe(false);
      expect(isCalendarViewMode('Week')).toBe(false);
    });

    it('rejects non-string values', () => {
      expect(isCalendarViewMode(undefined)).toBe(false);
      expect(isCalendarViewMode(null)).toBe(false);
      expect(isCalendarViewMode(42)).toBe(false);
      expect(isCalendarViewMode(['list'])).toBe(false);
      expect(isCalendarViewMode({ view: 'list' })).toBe(false);
    });
  });
});
