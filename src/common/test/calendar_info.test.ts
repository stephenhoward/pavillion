import { describe, it, expect } from 'vitest';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';

describe('CalendarInfo Model', () => {
  const calendar = new Calendar('cal-uuid-1', 'my-calendar');

  describe('canReviewReports', () => {
    it('returns false for editor when canReviewReports=false', () => {
      // pv-2ppm: editors without the flag cannot review reports — the
      // constructor mirrors the server-side rule.
      const info = new CalendarInfo(calendar, 'editor', false);
      expect(info.canReviewReports).toBe(false);
    });

    it('returns true for editor when canReviewReports=true', () => {
      // Editors with can_review_reports granted on the membership can review
      // reports for this calendar.
      const info = new CalendarInfo(calendar, 'editor', true);
      expect(info.canReviewReports).toBe(true);
    });

    it('returns true for owner even when canReviewReports=false is passed', () => {
      // Owners always have report-review access; the constructor coerces the
      // flag to true to keep the DTO consistent with the server rule.
      const info = new CalendarInfo(calendar, 'owner', false);
      expect(info.canReviewReports).toBe(true);
    });
  });
});
