import { describe, it, expect } from 'vitest';
import { calendarReportsPath } from '../../model/settings-links';

/*
 * The reports path is a contract with the client route table: the literal
 * below is the same one src/client/test/routing/settings-links-contract.test.ts
 * resolves from the `calendar_reports` route. Change both together.
 */
describe('calendarReportsPath', () => {
  it('addresses the calendar reports settings leaf by url name', () => {
    expect(calendarReportsPath('city-events')).toBe('/settings/calendar/city-events/reports');
  });

  it('encodes the url name as a single path segment', () => {
    expect(calendarReportsPath('city events/north')).toBe('/settings/calendar/city%20events%2Fnorth/reports');
  });

  it('carries no query string', () => {
    expect(calendarReportsPath('city-events')).not.toContain('?');
  });
});
