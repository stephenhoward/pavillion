import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';

import { CALENDAR_VIEW_MODES } from '@/common/model/calendar_view';
import {
  VIEW_QUERY_KEY,
  DATE_QUERY_KEY,
  calendarViewQuery,
  parseCalendarViewQuery,
} from '@/common/routing/calendar-view-query';

/** Drop the keys `calendarViewQuery` marked as absent, as a router would. */
function toRouteQuery(query: Record<string, string | undefined>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined),
  );
}

const anchor = DateTime.local(2026, 3, 14);

describe('calendar view query', () => {
  describe('key names', () => {
    it('spells the two keys once', () => {
      expect(VIEW_QUERY_KEY).toBe('view');
      expect(DATE_QUERY_KEY).toBe('date');
    });
  });

  describe('calendarViewQuery', () => {
    it('omits view when it equals the default', () => {
      expect(calendarViewQuery('month', anchor, 'month')[VIEW_QUERY_KEY]).toBeUndefined();
    });

    it('emits view=list when the default is month', () => {
      expect(calendarViewQuery('list', anchor, 'month')[VIEW_QUERY_KEY]).toBe('list');
    });

    it('emits the anchor date for week and month as a local calendar day', () => {
      expect(calendarViewQuery('week', anchor, 'list')[DATE_QUERY_KEY]).toBe('2026-03-14');
      expect(calendarViewQuery('month', anchor, 'list')[DATE_QUERY_KEY]).toBe('2026-03-14');
    });

    it('omits the date in list view', () => {
      expect(calendarViewQuery('list', anchor, 'month')[DATE_QUERY_KEY]).toBeUndefined();
    });

    it('ignores the time of day on the anchor', () => {
      const midEvening = DateTime.local(2026, 3, 14, 21, 45);

      expect(calendarViewQuery('week', midEvening, 'list')[DATE_QUERY_KEY]).toBe('2026-03-14');
    });
  });

  describe('round trip', () => {
    for (const defaultView of CALENDAR_VIEW_MODES) {
      for (const viewMode of CALENDAR_VIEW_MODES) {
        it(`restores ${viewMode} when the default is ${defaultView}`, () => {
          const query = toRouteQuery(calendarViewQuery(viewMode, anchor, defaultView));
          const parsed = parseCalendarViewQuery(query, defaultView);

          expect(parsed.viewMode).toBe(viewMode);
          if (viewMode === 'list') {
            // A list view carries no anchor, so parsing falls back to today.
            expect(parsed.anchorDate.toISODate()).toBe(DateTime.now().toISODate());
          }
          else {
            expect(parsed.anchorDate.toISODate()).toBe('2026-03-14');
          }
        });
      }
    }
  });

  describe('parseCalendarViewQuery', () => {
    it('falls back to the default view on an empty query', () => {
      expect(parseCalendarViewQuery({}, 'week').viewMode).toBe('week');
    });

    it('anchors to the local start of today when no date is given', () => {
      const { anchorDate } = parseCalendarViewQuery({}, 'month');

      expect(anchorDate.toISODate()).toBe(DateTime.now().toISODate());
      expect(anchorDate.hour).toBe(0);
      expect(anchorDate.minute).toBe(0);
      expect(anchorDate.second).toBe(0);
      expect(anchorDate.millisecond).toBe(0);
    });

    it('reads an explicit view over the default', () => {
      expect(parseCalendarViewQuery({ [VIEW_QUERY_KEY]: 'month' }, 'list').viewMode).toBe('month');
    });

    it('reads the date in any view, including list', () => {
      const { anchorDate } = parseCalendarViewQuery({ [DATE_QUERY_KEY]: '2026-03-14' }, 'list');

      expect(anchorDate.toISODate()).toBe('2026-03-14');
      expect(anchorDate.hour).toBe(0);
    });

    it('falls back to the default without throwing on a garbage view', () => {
      expect(parseCalendarViewQuery({ [VIEW_QUERY_KEY]: 'day' }, 'week').viewMode).toBe('week');
      expect(parseCalendarViewQuery({ [VIEW_QUERY_KEY]: '' }, 'week').viewMode).toBe('week');
      expect(parseCalendarViewQuery({ [VIEW_QUERY_KEY]: ['week'] }, 'list').viewMode).toBe('list');
      expect(parseCalendarViewQuery({ [VIEW_QUERY_KEY]: null }, 'list').viewMode).toBe('list');
    });

    it('falls back to today without throwing on a garbage date', () => {
      const today = DateTime.now().toISODate();

      for (const rawDate of ['not-a-date', '2026-13-45', '14/03/2026', '', 42, null, ['2026-03-14']]) {
        const { anchorDate } = parseCalendarViewQuery({ [DATE_QUERY_KEY]: rawDate }, 'month');

        expect(anchorDate.isValid).toBe(true);
        expect(anchorDate.toISODate()).toBe(today);
      }
    });

    it('falls back on a date that is not a bare calendar day', () => {
      const { anchorDate } = parseCalendarViewQuery(
        { [DATE_QUERY_KEY]: '2026-03-14T21:45:00Z' },
        'month',
      );

      expect(anchorDate.toISODate()).toBe(DateTime.now().toISODate());
    });

    it('parses each key independently of the other', () => {
      const parsed = parseCalendarViewQuery(
        { [VIEW_QUERY_KEY]: 'garbage', [DATE_QUERY_KEY]: '2026-03-14' },
        'week',
      );

      expect(parsed.viewMode).toBe('week');
      expect(parsed.anchorDate.toISODate()).toBe('2026-03-14');
    });
  });
});
