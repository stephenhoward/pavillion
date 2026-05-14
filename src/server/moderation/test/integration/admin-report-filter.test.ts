import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { ReportEntity } from '@/server/moderation/entity/report';
import { ReportCategory, ReportStatus } from '@/common/model/report';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for the calendar_id filter on the admin moderation
 * report list endpoint. Verifies that:
 *   - Reports are scoped correctly when calendar_id is provided
 *   - Omitting the filter returns the full admin-visible set
 *   - Invalid (non-UUID) calendar_id values return 400
 *   - Syntactically-valid but unknown calendar_ids return an empty list
 */
describe('Admin Report List - calendar_id filter (integration)', () => {
  let env: TestEnvironment;
  let authToken: string;
  const calendarAId = uuidv4();
  const calendarBId = uuidv4();

  const adminEmail = 'admin-reports-filter@pavillion.dev';
  const password = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // _setupAccount grants admin role in test mode
    await accountService._setupAccount(adminEmail, password);
    authToken = await env.login(adminEmail, password);
  });

  afterAll(async () => {
    await env.cleanup();
  });

  afterEach(async () => {
    await ReportEntity.destroy({ where: {} });
  });

  /**
   * Seeds an open (escalated) report so it appears in the admin list.
   * The admin list returns escalated reports OR admin-initiated reports.
   */
  async function seedEscalatedReport(calendarId: string, description: string): Promise<string> {
    const id = uuidv4();
    await ReportEntity.create({
      id,
      event_id: uuidv4(),
      calendar_id: calendarId,
      category: ReportCategory.SPAM,
      description,
      reporter_type: 'anonymous',
      status: ReportStatus.ESCALATED,
    });
    return id;
  }

  /**
   * Seeds an admin-initiated report against a remote event so it appears
   * in the admin list with `calendar_id === null`. Represents the
   * pv-o3ay.7 dispatch path.
   */
  async function seedRemoteAdminReport(description: string): Promise<string> {
    const id = uuidv4();
    await ReportEntity.create({
      id,
      event_id: uuidv4(),
      calendar_id: null,
      category: ReportCategory.SPAM,
      description,
      reporter_type: 'administrator',
      admin_id: uuidv4(),
      admin_priority: 'medium',
      status: ReportStatus.SUBMITTED,
    });
    return id;
  }

  it('returns only reports for the requested calendar_id', async () => {
    const reportA1 = await seedEscalatedReport(calendarAId, 'Calendar A report 1');
    const reportA2 = await seedEscalatedReport(calendarAId, 'Calendar A report 2');
    await seedEscalatedReport(calendarBId, 'Calendar B report 1');
    await seedEscalatedReport(calendarBId, 'Calendar B report 2');

    const response = await env.authGet(authToken, `/api/v1/admin/reports?calendar_id=${calendarAId}`);

    expect(response.status).toBe(200);
    expect(response.body.reports).toHaveLength(2);

    const returnedIds = response.body.reports.map((r: any) => r.id);
    expect(returnedIds).toContain(reportA1);
    expect(returnedIds).toContain(reportA2);

    for (const report of response.body.reports) {
      expect(report.calendarId).toBe(calendarAId);
    }
  });

  it('returns the full admin-visible set when the filter is omitted', async () => {
    await seedEscalatedReport(calendarAId, 'Calendar A report');
    await seedEscalatedReport(calendarAId, 'Calendar A report 2');
    await seedEscalatedReport(calendarBId, 'Calendar B report');
    await seedEscalatedReport(calendarBId, 'Calendar B report 2');

    const response = await env.authGet(authToken, '/api/v1/admin/reports');

    expect(response.status).toBe(200);
    expect(response.body.reports).toHaveLength(4);

    const calendarIds = new Set<string>(response.body.reports.map((r: any) => r.calendarId));
    expect(calendarIds.has(calendarAId)).toBe(true);
    expect(calendarIds.has(calendarBId)).toBe(true);
  });

  it('returns 400 when calendar_id is not a valid UUID', async () => {
    await seedEscalatedReport(calendarAId, 'Calendar A report');

    const response = await env.authGet(authToken, '/api/v1/admin/reports?calendar_id=not-a-uuid');

    expect(response.status).toBe(400);
    expect(response.body.errorName).toBe('ValidationError');
  });

  it('returns an empty list (not 404) for a syntactically-valid but unknown calendar_id', async () => {
    await seedEscalatedReport(calendarAId, 'Calendar A report');
    const unknownCalendarId = uuidv4();

    const response = await env.authGet(authToken, `/api/v1/admin/reports?calendar_id=${unknownCalendarId}`);

    expect(response.status).toBe(200);
    expect(response.body.reports).toHaveLength(0);
  });

  it('includes null-calendarId admin reports when no calendar_id filter is provided', async () => {
    // Admin reports against remote events have calendar_id === null
    // (pv-o3ay.7). They should appear in the unfiltered admin list since
    // they satisfy the `reporter_type === 'administrator'` half of the
    // base OR clause.
    const remoteAdminReportId = await seedRemoteAdminReport('Remote event spam');
    await seedEscalatedReport(calendarAId, 'Local escalated report');

    const response = await env.authGet(authToken, '/api/v1/admin/reports');

    expect(response.status).toBe(200);
    expect(response.body.reports).toHaveLength(2);

    const returnedIds = response.body.reports.map((r: any) => r.id);
    expect(returnedIds).toContain(remoteAdminReportId);

    const remoteReport = response.body.reports.find((r: any) => r.id === remoteAdminReportId);
    expect(remoteReport.calendarId).toBeNull();
    expect(remoteReport.reporterType).toBe('administrator');
  });

  it('excludes null-calendarId admin reports when a calendar_id filter is provided', async () => {
    // A calendar-scoped admin query must not surface remote-event admin
    // reports, since those reports do not belong to any local calendar.
    await seedRemoteAdminReport('Remote event spam');
    const calendarAReportId = await seedEscalatedReport(calendarAId, 'Local A report');

    const response = await env.authGet(authToken, `/api/v1/admin/reports?calendar_id=${calendarAId}`);

    expect(response.status).toBe(200);
    expect(response.body.reports).toHaveLength(1);
    expect(response.body.reports[0].id).toBe(calendarAReportId);
    expect(response.body.reports[0].calendarId).toBe(calendarAId);
  });
});
