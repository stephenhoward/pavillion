import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import db from '@/server/common/entity/db';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { DiskUsageSnapshotEntity } from '@/server/housekeeping/entity/disk-snapshot';
import { DiskUsageStats } from '@/server/housekeeping/service/disk-monitor';
import DiskSnapshotService, { BACKUP_PATH_STAT_KEY } from '@/server/housekeeping/service/disk-snapshot';
import AlertsService from '@/server/housekeeping/service/alerts';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';

// The email models are mocked so these tests need no i18n setup; the real
// templates are rendered through this flow by disk-alert-render.test.ts.
vi.mock('@/server/housekeeping/model/disk-warning-email', () => ({
  default: class {
    constructor(
      usagePercent: number,
      threshold: number,
      usedSpace: string,
      totalSpace: string,
      private recipientEmail: string,
    ) {}
    buildMessage() {
      return { from: 'noreply@example.test', to: (this as any).recipientEmail, subject: 'Disk Warning', text: 'Warning' };
    }
  },
}));

vi.mock('@/server/housekeeping/model/disk-critical-email', () => ({
  default: class {
    constructor(
      usagePercent: number,
      threshold: number,
      usedSpace: string,
      totalSpace: string,
      private recipientEmail: string,
    ) {}
    buildMessage() {
      return { from: 'noreply@example.test', to: (this as any).recipientEmail, subject: 'Disk Critical', text: 'Critical' };
    }
  },
}));

const THRESHOLDS = { warning: 80, critical: 90 };
const START = new Date('2026-11-20T00:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const ADMIN_COUNT = 2;

function hoursAfterStart(hours: number): Date {
  return new Date(START.getTime() + hours * HOUR_MS);
}

function reading(percentageUsed: number): DiskUsageStats {
  const usedBytes = BigInt(Math.round(percentageUsed * 10));
  return {
    totalBytes: BigInt(1000),
    usedBytes,
    freeBytes: BigInt(1000) - usedBytes,
    percentageUsed,
    path: '/backups',
  };
}

/**
 * The disk alert's cadence against a real snapshot row and real
 * administrators: one alert per change of level, then at most one a day while
 * the level holds, with the state kept on the row so a worker restart does not
 * resend. Each check mirrors the disk:check handler — record the snapshot,
 * then process the reading — with the clock injected.
 */
describe('Disk alert flow', () => {
  let sandbox: sinon.SinonSandbox;
  let emailInterface: EmailInterface;
  let sendEmailStub: sinon.SinonStub;
  let snapshots: DiskSnapshotService;
  let alerts: AlertsService;

  beforeAll(async () => {
    await db.sync({ force: true });

    const env = new TestEnvironment();
    await env.createAdminAccount('disk-admin-1@example.test', 'disk-admin-pw!1');
    await env.createAdminAccount('disk-admin-2@example.test', 'disk-admin-pw!2');
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    await DiskUsageSnapshotEntity.destroy({ where: {}, truncate: true });

    emailInterface = new EmailInterface();
    sendEmailStub = sandbox.stub(emailInterface, 'sendEmail').resolves(null);
    snapshots = new DiskSnapshotService();
    alerts = newAlertsService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  /** A fresh service, as a restarted worker would build. */
  function newAlertsService(): AlertsService {
    return new AlertsService(emailInterface, new AccountsInterface(), new DiskSnapshotService());
  }

  async function check(percentageUsed: number, at: Date, service: AlertsService = alerts): Promise<void> {
    const usage = reading(percentageUsed);
    await snapshots.recordSnapshot(BACKUP_PATH_STAT_KEY, usage, at);
    await service.processDiskReading(usage, THRESHOLDS, at);
  }

  /** Subjects of the alerts sent, one entry per alert rather than per message. */
  function alertsSent(): string[] {
    const subjects = sendEmailStub.getCalls().map(call => call.args[0].subject as string);
    return subjects.filter((_subject, index) => index % ADMIN_COUNT === 0);
  }

  async function storedRow(): Promise<DiskUsageSnapshotEntity> {
    const row = await DiskUsageSnapshotEntity.findByPk(BACKUP_PATH_STAT_KEY);
    expect(row).not.toBeNull();
    return row!;
  }

  it('sends one alert across three hourly checks at critical, one message per administrator', async () => {
    await check(95, hoursAfterStart(0));
    await check(95, hoursAfterStart(1));
    await check(96, hoursAfterStart(2));

    expect(sendEmailStub.callCount).toBe(ADMIN_COUNT);
    expect(sendEmailStub.getCalls().map(call => call.args[0].to).sort()).toEqual([
      'disk-admin-1@example.test',
      'disk-admin-2@example.test',
    ]);
  });

  it('does not resend after a restart: a fresh service reads the state from the row', async () => {
    await check(95, hoursAfterStart(0));
    await check(95, hoursAfterStart(1), newAlertsService());

    expect(alertsSent()).toEqual(['Disk Critical']);
  });

  it('sends warning then critical immediately when the level rises', async () => {
    await check(85, hoursAfterStart(0));
    await check(92, hoursAfterStart(1));

    expect(alertsSent()).toEqual(['Disk Warning', 'Disk Critical']);
  });

  it('resends the same level only once 24 hours have passed', async () => {
    await check(95, hoursAfterStart(0));
    await check(95, hoursAfterStart(23));
    expect(alertsSent()).toEqual(['Disk Critical']);

    await check(95, hoursAfterStart(24));
    expect(alertsSent()).toEqual(['Disk Critical', 'Disk Critical']);
  });

  it('a normal reading clears the state, so the next crossing sends', async () => {
    await check(95, hoursAfterStart(0));
    await check(50, hoursAfterStart(1));

    const cleared = await storedRow();
    expect(cleared.alert_level).toBeNull();
    expect(cleared.alert_sent_at).toBeNull();

    await check(95, hoursAfterStart(2));
    expect(alertsSent()).toEqual(['Disk Critical', 'Disk Critical']);
  });

  it('records no state when no administrator is reached, and the next run sends', async () => {
    sendEmailStub.rejects(new Error('SMTP not configured'));
    await check(95, hoursAfterStart(0));

    const unsent = await storedRow();
    expect(unsent.alert_level).toBeNull();
    expect(unsent.alert_sent_at).toBeNull();

    sendEmailStub.resetBehavior();
    sendEmailStub.resolves(null);
    sendEmailStub.resetHistory();
    await check(95, hoursAfterStart(1));

    expect(sendEmailStub.callCount).toBe(ADMIN_COUNT);
    expect((await storedRow()).alert_level).toBe('critical');
  });

  it('records state when one of two administrators is reached', async () => {
    sendEmailStub.onFirstCall().rejects(new Error('SMTP rejected'));

    await check(95, hoursAfterStart(0));

    const row = await storedRow();
    expect(row.alert_level).toBe('critical');
    expect(row.alert_sent_at!.getTime()).toBe(hoursAfterStart(0).getTime());
  });

  it('setAlertState leaves written_at unchanged', async () => {
    const measuredAt = hoursAfterStart(0);
    await snapshots.recordSnapshot(BACKUP_PATH_STAT_KEY, reading(95), measuredAt);

    await snapshots.setAlertState(BACKUP_PATH_STAT_KEY, 'critical', hoursAfterStart(5));

    const row = await storedRow();
    expect(row.written_at.getTime()).toBe(measuredAt.getTime());
    expect(row.alert_level).toBe('critical');
  });

  // Regression: the hourly snapshot upsert must write only the measurement
  // columns. If it wrote every column it would clear the alert state each
  // run, and the alert would go out every hour again.
  it('recordSnapshot leaves the alert columns unchanged and updates the bytes', async () => {
    const sentAt = hoursAfterStart(0);
    await snapshots.recordSnapshot(BACKUP_PATH_STAT_KEY, reading(95), sentAt);
    await snapshots.setAlertState(BACKUP_PATH_STAT_KEY, 'critical', sentAt);

    await snapshots.recordSnapshot(BACKUP_PATH_STAT_KEY, reading(97), hoursAfterStart(1));

    const row = await storedRow();
    expect(row.alert_level).toBe('critical');
    expect(row.alert_sent_at!.getTime()).toBe(sentAt.getTime());
    expect(Number(row.used_bytes)).toBe(970);
    expect(row.written_at.getTime()).toBe(hoursAfterStart(1).getTime());
  });
});
