import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { ReportEntity } from '@/server/moderation/entity/report';
import { ReportCategory, ReportStatus } from '@/common/model/report';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests that verify a report row with `calendar_id === null`
 * (the row shape produced when a beta admin files a report against an
 * alpha-hosted remote event, per pv-o3ay.7) round-trips through the
 * database cleanly.
 *
 * Service-level branching is covered by the service unit tests; route
 * dispatch is covered by the admin-report API tests. This file fills the
 * persistence-tier gap: prove that the column is in fact nullable on the
 * actual sequelize-synced schema, and that a null-calendar_id row can be
 * created, read back, and read out via `ReportEntity.toModel()` with
 * `Report.calendarId === null`.
 */
describe('Remote-event admin report persistence (integration)', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  afterEach(async () => {
    await ReportEntity.destroy({ where: {} });
  });

  it('persists a report with calendar_id === null and reads it back via toModel', async () => {
    const reportId = uuidv4();
    const eventId = uuidv4();
    const adminId = uuidv4();

    await ReportEntity.create({
      id: reportId,
      event_id: eventId,
      calendar_id: null,
      category: ReportCategory.SPAM,
      description: 'Reported a remote event',
      reporter_type: 'administrator',
      admin_id: adminId,
      admin_priority: 'high',
      status: ReportStatus.SUBMITTED,
    });

    const refetched = await ReportEntity.findByPk(reportId);
    expect(refetched).not.toBeNull();
    expect(refetched!.calendar_id).toBeNull();

    const model = refetched!.toModel();
    expect(model.id).toBe(reportId);
    expect(model.eventId).toBe(eventId);
    expect(model.calendarId).toBeNull();
    expect(model.reporterType).toBe('administrator');
    expect(model.adminId).toBe(adminId);
    expect(model.adminPriority).toBe('high');
    expect(model.status).toBe(ReportStatus.SUBMITTED);
  });

  it('preserves null calendar_id through an entity update', async () => {
    // Verifies that the nullable column survives a partial update without
    // being coerced back to a non-null value (e.g. a default applied by
    // an ORM-level type misconfiguration).
    const reportId = uuidv4();

    await ReportEntity.create({
      id: reportId,
      event_id: uuidv4(),
      calendar_id: null,
      category: ReportCategory.SPAM,
      description: 'Initial description',
      reporter_type: 'administrator',
      admin_id: uuidv4(),
      admin_priority: 'medium',
      status: ReportStatus.SUBMITTED,
    });

    const entity = await ReportEntity.findByPk(reportId);
    expect(entity).not.toBeNull();
    await entity!.update({ owner_notes: 'Reviewed' });

    const refetched = await ReportEntity.findByPk(reportId);
    expect(refetched!.calendar_id).toBeNull();
    expect(refetched!.owner_notes).toBe('Reviewed');
  });
});
