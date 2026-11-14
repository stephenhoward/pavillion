import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { ReportEntity } from '@/server/moderation/entity/report';
import { ReportCategory, ReportStatus } from '@/common/model/report';
import ModerationService from '@/server/moderation/service/moderation';
import { ReportNotVerifiedError } from '@/server/moderation/exceptions';
import AccountService from '@/server/accounts/service/account';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * A report in pending_verification (the anonymous reporter has not yet
 * confirmed their email) is invisible to the calendar's owner and cannot be
 * acted on until verifyReport moves it to submitted. Driven through the real
 * owner routes against a real database.
 */
describe('owner report routes - pending_verification reports are hidden (integration)', () => {
  let env: TestEnvironment;
  let ownerAuthKey: string;
  let calendarId: string;
  let service: ModerationService;
  const ownerEmail = 'pending-hidden-owner@pavillion.dev';
  const password = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const accountService = new AccountService(eventBus, new ConfigurationInterface(), new SetupInterface());
    const ownerInfo = await accountService._setupAccount(ownerEmail, password);
    const calendar = await calendarInterface.createCalendar(ownerInfo.account, 'pendinghidden');
    calendarId = calendar.id;
    ownerAuthKey = await env.login(ownerEmail, password);
    service = new ModerationService(new EventEmitter());
  });

  afterAll(async () => {
    await env.cleanup();
  });

  afterEach(async () => {
    await ReportEntity.destroy({ where: {} });
  });

  async function seedReport(status: ReportStatus): Promise<string> {
    const id = uuidv4();
    await ReportEntity.create({
      id,
      event_id: uuidv4(),
      calendar_id: calendarId,
      category: ReportCategory.SPAM,
      description: `report ${status}`,
      reporter_type: 'anonymous',
      status,
    });
    return id;
  }

  const base = () => `/api/v1/calendars/${calendarId}/reports`;

  it('omits pending reports from the default list and keeps verified ones', async () => {
    const pendingId = await seedReport(ReportStatus.PENDING_VERIFICATION);
    const submittedId = await seedReport(ReportStatus.SUBMITTED);

    const response = await env.authGet(ownerAuthKey, base());

    expect(response.status).toBe(200);
    const ids = response.body.reports.map((r: any) => r.id);
    expect(ids).toContain(submittedId);
    expect(ids).not.toContain(pendingId);
    expect(response.body.pagination.totalCount).toBe(1);
  });

  it('returns an empty list for an explicit status=pending_verification filter', async () => {
    await seedReport(ReportStatus.PENDING_VERIFICATION);
    await seedReport(ReportStatus.SUBMITTED);

    const response = await env.authGet(ownerAuthKey, `${base()}?status=pending_verification`);

    expect(response.status).toBe(200);
    expect(response.body.reports).toEqual([]);
    expect(response.body.pagination.totalCount).toBe(0);
  });

  it('does not count pending reports as open', async () => {
    await seedReport(ReportStatus.PENDING_VERIFICATION);
    expect((await service.getOpenReportCountsForCalendars([calendarId])).get(calendarId)).toBeUndefined();

    await seedReport(ReportStatus.SUBMITTED);
    expect((await service.getOpenReportCountsForCalendars([calendarId])).get(calendarId)).toBe(1);
  });

  it('reads a pending report as not found on get, resolve and dismiss, leaving it untouched', async () => {
    const pendingId = await seedReport(ReportStatus.PENDING_VERIFICATION);

    const get = await env.authGet(ownerAuthKey, `${base()}/${pendingId}`);
    const resolve = await env.authPost(ownerAuthKey, `${base()}/${pendingId}/resolve`, { notes: 'done' });
    const dismiss = await env.authPost(ownerAuthKey, `${base()}/${pendingId}/dismiss`, { notes: 'no' });

    expect(get.status).toBe(404);
    expect(resolve.status).toBe(404);
    expect(dismiss.status).toBe(404);
    const entity = await ReportEntity.findByPk(pendingId);
    expect(entity!.status).toBe(ReportStatus.PENDING_VERIFICATION);
  });

  it('refuses resolve and dismiss on a pending report at the service level', async () => {
    const pendingId = await seedReport(ReportStatus.PENDING_VERIFICATION);

    await expect(service.resolveReport(pendingId, uuidv4(), 'n')).rejects.toThrow(ReportNotVerifiedError);
    await expect(service.dismissReport(pendingId, uuidv4(), 'n')).rejects.toThrow(ReportNotVerifiedError);
    expect((await ReportEntity.findByPk(pendingId))!.status).toBe(ReportStatus.PENDING_VERIFICATION);
  });

  it('still resolves and dismisses a verified report', async () => {
    const resolveId = await seedReport(ReportStatus.SUBMITTED);
    const dismissId = await seedReport(ReportStatus.SUBMITTED);

    const resolve = await env.authPost(ownerAuthKey, `${base()}/${resolveId}/resolve`, { notes: 'done' });
    const dismiss = await env.authPost(ownerAuthKey, `${base()}/${dismissId}/dismiss`, { notes: 'no' });

    expect(resolve.status).toBe(200);
    expect(dismiss.status).toBe(200);
    expect((await ReportEntity.findByPk(dismissId))!.status).toBe(ReportStatus.ESCALATED);
  });
});
