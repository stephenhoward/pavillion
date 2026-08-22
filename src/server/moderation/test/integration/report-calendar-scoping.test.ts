import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { ReportEntity } from '@/server/moderation/entity/report';
import { ReportCategory, ReportStatus } from '@/common/model/report';
import ModerationService from '@/server/moderation/service/moderation';
import { ReportNotFoundError } from '@/server/moderation/exceptions';
import AccountService from '@/server/accounts/service/account';
import { AccountRoleEntity } from '@/server/common/entity/account';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for the calendar scoping applied by
 * ModerationService.getReportForCalendar against a real database.
 *
 * The owner-facing report routes read every report through this method, so
 * the scoping is what keeps one calendar's owner from reaching another
 * calendar's report by id. A report that belongs to a different calendar,
 * a report that never existed, and a report that has since been deleted all
 * have to fail the same way — the privacy-playbook `error-responses` standard
 * (no existence disclosure) applied to an authenticated owner surface, plus
 * ordinary IDOR hygiene. Not DEC-004: that decision governs anonymous attendee
 * access to public event information and explicitly excludes organizer,
 * curator and admin surfaces; see DEC-015 (Consequences).
 */
describe('ModerationService.getReportForCalendar - calendar scoping (integration)', () => {
  let env: TestEnvironment;
  let service: ModerationService;

  const calendarAId = uuidv4();
  const calendarBId = uuidv4();

  // Real, owned calendars are needed for the route-level cases, where the
  // request has to pass the owner permission check before the report is read.
  //
  // Two accounts, because the permission check takes different paths for each.
  // The first account created under NODE_ENV=test is granted the instance admin
  // role, and userCanReviewReports short-circuits true for admins without ever
  // consulting CalendarMemberEntity - so an admin never exercises the owner
  // deep-link path the route case is about. The second account gets no admin
  // role and reaches the route purely through its owner membership.
  let adminAuthKey: string;
  let adminCalendarId: string;
  let ownerAuthKey: string;
  let ownedCalendarId: string;
  const adminEmail = 'report-scoping-admin@pavillion.dev';
  const ownerEmail = 'report-scoping-owner@pavillion.dev';
  const password = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const calendarInterface = new CalendarInterface(eventBus);
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // First account: receives the instance admin role automatically.
    const adminInfo = await accountService._setupAccount(adminEmail, password);
    const adminCalendar = await calendarInterface.createCalendar(adminInfo.account, 'reportscopingadmin');
    adminCalendarId = adminCalendar.id;
    adminAuthKey = await env.login(adminEmail, password);

    // Second account: no admin role, reaches its calendar as owner only.
    const ownerInfo = await accountService._setupAccount(ownerEmail, password);
    // Guards the premise of the non-admin route case below: if this account
    // ever picked up the admin role, userCanReviewReports would short-circuit
    // and the owner membership path would go untested.
    const ownerRoles = await AccountRoleEntity.findAll({ where: { account_id: ownerInfo.account.id } });
    expect(ownerRoles.map((role) => role.role)).not.toContain('admin');
    const ownedCalendar = await calendarInterface.createCalendar(ownerInfo.account, 'reportscoping');
    ownedCalendarId = ownedCalendar.id;
    ownerAuthKey = await env.login(ownerEmail, password);
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(() => {
    service = new ModerationService(new EventEmitter());
  });

  afterEach(async () => {
    await ReportEntity.destroy({ where: {} });
  });

  /**
   * Seeds a report owned by the given calendar. Passing null models an
   * admin-initiated report against a remote event, which has no owning
   * calendar on this instance.
   */
  async function seedReport(calendarId: string | null, description: string): Promise<string> {
    const id = uuidv4();
    await ReportEntity.create({
      id,
      event_id: uuidv4(),
      calendar_id: calendarId,
      category: ReportCategory.SPAM,
      description,
      reporter_type: calendarId === null ? 'administrator' : 'anonymous',
      admin_id: calendarId === null ? uuidv4() : null,
      status: ReportStatus.SUBMITTED,
    });
    return id;
  }

  it('returns the report when it belongs to the requested calendar', async () => {
    const reportId = await seedReport(calendarAId, 'Calendar A report');

    const report = await service.getReportForCalendar(reportId, calendarAId);

    expect(report.id).toBe(reportId);
    expect(report.calendarId).toBe(calendarAId);
    expect(report.description).toBe('Calendar A report');
  });

  it('raises ReportNotFoundError for a report that belongs to a different calendar', async () => {
    const reportId = await seedReport(calendarBId, 'Calendar B report');

    await expect(service.getReportForCalendar(reportId, calendarAId))
      .rejects.toThrow(ReportNotFoundError);
  });

  it('raises ReportNotFoundError for an id that never existed - the same path covers a report deleted after its notification was created', async () => {
    // A notification can outlive the report it points at. Following that
    // stale link is the same query as an id that was never issued, and it
    // has to produce the same error rather than a distinguishable one.
    const deletedReportId = await seedReport(calendarAId, 'Report that gets deleted');
    await ReportEntity.destroy({ where: { id: deletedReportId } });

    await expect(service.getReportForCalendar(deletedReportId, calendarAId))
      .rejects.toThrow(ReportNotFoundError);

    await expect(service.getReportForCalendar(uuidv4(), calendarAId))
      .rejects.toThrow(ReportNotFoundError);
  });

  it('raises ReportNotFoundError for an admin-initiated report against a remote event (calendar_id IS NULL)', async () => {
    const remoteReportId = await seedReport(null, 'Remote event spam');

    await expect(service.getReportForCalendar(remoteReportId, calendarAId))
      .rejects.toThrow(ReportNotFoundError);
  });

  it('fails identically for a wrong-calendar report and an id that never existed', async () => {
    const foreignReportId = await seedReport(calendarBId, 'Calendar B report');
    const unknownReportId = uuidv4();

    const foreignError = await service.getReportForCalendar(foreignReportId, calendarAId)
      .then(() => null, (error: unknown) => error as Error);
    const unknownError = await service.getReportForCalendar(unknownReportId, calendarAId)
      .then(() => null, (error: unknown) => error as Error);

    expect(foreignError).toBeInstanceOf(ReportNotFoundError);
    expect(unknownError).toBeInstanceOf(ReportNotFoundError);
    expect(foreignError!.name).toBe(unknownError!.name);
    expect(foreignError!.message).toBe(unknownError!.message);
  });

  it('raises ReportNotFoundError for a missing calendarId instead of matching the calendar_id IS NULL rows', async () => {
    // Sequelize renders `calendar_id: null` as `calendar_id IS NULL`, which
    // would invert the scope into "every admin-initiated report against a
    // remote event" - the one set the owner path must never return.
    const remoteReportId = await seedReport(null, 'Remote event spam');

    await expect(service.getReportForCalendar(remoteReportId, null as unknown as string))
      .rejects.toThrow(ReportNotFoundError);
    await expect(service.getReportForCalendar(remoteReportId, ''))
      .rejects.toThrow(ReportNotFoundError);
  });

  it('raises ReportNotFoundError for a missing reportId', async () => {
    await seedReport(calendarAId, 'Calendar A report');

    await expect(service.getReportForCalendar(null as unknown as string, calendarAId))
      .rejects.toThrow(ReportNotFoundError);
    await expect(service.getReportForCalendar('', calendarAId))
      .rejects.toThrow(ReportNotFoundError);
  });

  describe('owner report route', () => {

    /**
     * Drives a foreign report id and an id that never existed through the real
     * route as the given account, and asserts the two responses are
     * indistinguishable.
     *
     * The standalone 404 assertion comes first on purpose: it is what makes the
     * equality non-vacuous. Without it a 403 short-circuit before the report is
     * ever read would also produce two equal responses and prove nothing.
     */
    async function expectIndistinguishable404s(authKey: string, calendarId: string): Promise<void> {
      const foreignReportId = await seedReport(calendarBId, 'Calendar B report');
      const unknownReportId = uuidv4();

      const foreignResponse = await env.authGet(
        authKey,
        `/api/v1/calendars/${calendarId}/reports/${foreignReportId}`,
      );
      const unknownResponse = await env.authGet(
        authKey,
        `/api/v1/calendars/${calendarId}/reports/${unknownReportId}`,
      );

      expect(foreignResponse.status).toBe(404);
      expect(foreignResponse.status).toBe(unknownResponse.status);
      expect(JSON.stringify(foreignResponse.body)).toBe(JSON.stringify(unknownResponse.body));
    }

    it('returns an identical response for a foreign report id and an id that never existed, for a non-admin calendar owner', async () => {
      // The service tests above prove both cases raise the same error, and the
      // route tests prove ReportNotFoundError maps to a 404 - but those route
      // tests stub the service, so the two cases are only equal by
      // construction of the stub. This drives a real report through the real
      // service to a real HTTP response so the `error-responses` no-disclosure
      // contract is proved end to end.
      //
      // The account here holds no admin role, so the permission check resolves
      // through its owner membership - the deep-link path a calendar owner
      // actually takes.
      await expectIndistinguishable404s(ownerAuthKey, ownedCalendarId);
    });

    it('returns an identical response for a foreign report id and an id that never existed, for an instance admin', async () => {
      // Admins reach the route through the userCanReviewReports short-circuit
      // rather than a membership lookup. The service applies no admin
      // exemption, so the same no-disclosure contract has to hold here too.
      await expectIndistinguishable404s(adminAuthKey, adminCalendarId);
    });
  });
});
