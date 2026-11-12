import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { DateTime } from 'luxon';

import ModerationService from '@/server/moderation/service/moderation';
import UnverifiedReportCleanupService from '@/server/moderation/service/unverified-report-cleanup';
import { ReportEntity } from '@/server/moderation/entity/report';
import { EventReporterEntity } from '@/server/moderation/entity/event_reporter';
import { ReportStatus, ReportCategory } from '@/common/model/report';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

const EMAIL = 'reporter@example.com';

describe('UnverifiedReportCleanupService Integration', () => {
  let env: TestEnvironment;
  let service: UnverifiedReportCleanupService;
  let moderation: ModerationService;
  let emailHash: string;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(() => {
    service = new UnverifiedReportCleanupService();
    moderation = new ModerationService(new EventEmitter());
    emailHash = moderation.hashEmail(EMAIL);
  });

  afterEach(async () => {
    await ReportEntity.destroy({ where: {} });
    await EventReporterEntity.destroy({ where: {} });
  });

  /** Inserts a report plus its event_reporter row directly. */
  async function seed(status: string, expiresInHours: number | null, eventId = uuidv4()) {
    const id = uuidv4();
    await ReportEntity.create({
      id,
      event_id: eventId,
      calendar_id: uuidv4(),
      category: ReportCategory.SPAM,
      description: 'seeded',
      reporter_type: 'anonymous',
      reporter_email_hash: emailHash,
      status,
      verification_expiration: expiresInHours === null
        ? null
        : DateTime.now().plus({ hours: expiresInHours }).toJSDate(),
    });
    await EventReporterEntity.create({ id: uuidv4(), event_id: eventId, reporter_identifier: emailHash, report_id: id });
    return { id, eventId };
  }

  const reportExists = async (id: string) => (await ReportEntity.findByPk(id)) !== null;
  const reporterRowExists = async (reportId: string) =>
    (await EventReporterEntity.findOne({ where: { report_id: reportId } })) !== null;

  it('removes an expired pending report and its reporter row', async () => {
    const { id } = await seed(ReportStatus.PENDING_VERIFICATION, -1);

    const result = await service.cleanupExpiredUnverifiedReports();

    expect(result).toEqual({ reportsDeleted: 1, reporterRowsDeleted: 1 });
    expect(await reportExists(id)).toBe(false);
    expect(await reporterRowExists(id)).toBe(false);
  });

  it('leaves an unexpired pending report untouched', async () => {
    const { id } = await seed(ReportStatus.PENDING_VERIFICATION, 12);

    await service.cleanupExpiredUnverifiedReports();

    expect(await reportExists(id)).toBe(true);
    expect(await reporterRowExists(id)).toBe(true);
  });

  it('leaves a submitted report untouched', async () => {
    const { id } = await seed(ReportStatus.SUBMITTED, -1);

    await service.cleanupExpiredUnverifiedReports();

    expect(await reportExists(id)).toBe(true);
    expect(await reporterRowExists(id)).toBe(true);
  });

  it('leaves a resolved report with a past verification_expiration untouched', async () => {
    const { id } = await seed(ReportStatus.RESOLVED, -1);

    await service.cleanupExpiredUnverifiedReports();

    expect(await reportExists(id)).toBe(true);
    expect(await reporterRowExists(id)).toBe(true);
  });

  it('lets the same email re-report after the sweep', async () => {
    const { eventId } = await seed(ReportStatus.PENDING_VERIFICATION, -1);

    await service.cleanupExpiredUnverifiedReports();
    const report = await moderation.createReport({
      eventId,
      calendarId: uuidv4(),
      category: ReportCategory.SPAM,
      description: 'again',
      reporterEmail: EMAIL,
      reporterType: 'anonymous',
    });

    expect(report.status).toBe(ReportStatus.PENDING_VERIFICATION);
  });

  it('lets the same email re-report an expired one with no sweep, removing the old rows', async () => {
    const { id, eventId } = await seed(ReportStatus.PENDING_VERIFICATION, -1);

    await moderation.createReport({
      eventId,
      calendarId: uuidv4(),
      category: ReportCategory.SPAM,
      description: 'again',
      reporterEmail: EMAIL,
      reporterType: 'anonymous',
    });

    expect(await reportExists(id)).toBe(false);
    expect(await ReportEntity.count({ where: { event_id: eventId } })).toBe(1);
    expect(await EventReporterEntity.count({ where: { event_id: eventId } })).toBe(1);
  });

  it('still raises DuplicateReportError for an unexpired pending report', async () => {
    const { id, eventId } = await seed(ReportStatus.PENDING_VERIFICATION, 12);

    await expect(moderation.createReport({
      eventId,
      calendarId: uuidv4(),
      category: ReportCategory.SPAM,
      description: 'again',
      reporterEmail: EMAIL,
      reporterType: 'anonymous',
    })).rejects.toMatchObject({ name: 'DuplicateReportError' });

    expect(await reportExists(id)).toBe(true);
  });
});
