import { describe, it, expect } from 'vitest';
import { adminAccountsPath, adminModerationReportPath, calendarReportsPath } from '@/server/common/helper/settings-links';

/*
 * These paths are a contract with the client route table: each literal below
 * is the same one src/client/test/routing/settings-links-contract.test.ts
 * resolves from the matching named route. Change both together.
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

describe('adminModerationReportPath', () => {
  it('addresses the admin moderation report detail leaf by report id', () => {
    expect(adminModerationReportPath('report-uuid-123')).toBe('/settings/admin/moderation/reports/report-uuid-123');
  });

  it('encodes the report id as a single path segment', () => {
    expect(adminModerationReportPath('a b/c')).toBe('/settings/admin/moderation/reports/a%20b%2Fc');
  });

  it('carries no query string', () => {
    expect(adminModerationReportPath('report-uuid-123')).not.toContain('?');
  });
});

describe('adminAccountsPath', () => {
  it('addresses the admin accounts settings leaf', () => {
    expect(adminAccountsPath()).toBe('/settings/admin/accounts');
  });

  it('carries no query string', () => {
    expect(adminAccountsPath()).not.toContain('?');
  });
});
