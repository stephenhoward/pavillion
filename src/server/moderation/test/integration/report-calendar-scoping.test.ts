import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { ReportEntity } from '@/server/moderation/entity/report';
import { ReportCategory, ReportStatus } from '@/common/model/report';
import ModerationService from '@/server/moderation/service/moderation';
import { ReportNotFoundError } from '@/server/moderation/exceptions';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for the calendar scoping applied by
 * ModerationService.getReportForCalendar against a real database.
 *
 * The owner-facing report routes read every report through this method, so
 * the scoping is what keeps one calendar's owner from reaching another
 * calendar's report by id. A report that belongs to a different calendar,
 * a report that never existed, and a report that has since been deleted all
 * have to fail the same way (DEC-004: no existence disclosure).
 */
describe('ModerationService.getReportForCalendar - calendar scoping (integration)', () => {
  let env: TestEnvironment;
  let service: ModerationService;

  const calendarAId = uuidv4();
  const calendarBId = uuidv4();

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
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
});
