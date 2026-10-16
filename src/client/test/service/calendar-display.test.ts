import { describe, it, expect } from 'vitest';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { calendarDisplayName } from '@/client/service/calendar-display';

describe('calendarDisplayName', () => {
  it('uses the English name when there is one', () => {
    const calendar = new Calendar('c1', 'river-arts');
    calendar.addContent(new CalendarContent('en', 'River Arts'));
    expect(calendarDisplayName(calendar)).toBe('River Arts');
  });

  it('falls back to the url name when the English name is blank', () => {
    const calendar = new Calendar('c1', 'river-arts');
    calendar.addContent(new CalendarContent('en', ''));
    expect(calendarDisplayName(calendar)).toBe('river-arts');
  });

  it('falls back to the url name when only another language has a name', () => {
    const calendar = new Calendar('c1', 'river-arts');
    calendar.addContent(new CalendarContent('es', 'Artes del Río'));
    expect(calendarDisplayName(calendar)).toBe('river-arts');
  });
});
