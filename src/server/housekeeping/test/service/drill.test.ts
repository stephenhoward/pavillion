import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { BackupDrillEntity } from '@/server/housekeeping/entity/drill';
import DrillService, { DRILL_DETAIL_MAX_LENGTH } from '@/server/housekeeping/service/drill';

/**
 * DrillService owns the durable record of restore-drill outcomes: what the CLI
 * writes when scripts/restore-drill.sh finishes, and what the "last successful
 * drill" staleness signal reads back.
 */
describe('DrillService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: DrillService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new DrillService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('recordResult', () => {
    it('appends a passing run against the drilled filename', async () => {
      const createStub = sandbox.stub(BackupDrillEntity, 'create').resolves();
      const ranAt = new Date('2026-09-01T03:00:00Z');

      await service.recordResult(
        { backupFilename: 'pavillion_20260901_020000_scheduled.dump', passed: true },
        ranAt,
      );

      const row = createStub.firstCall.args[0] as Record<string, unknown>;
      expect(row.backup_filename).toBe('pavillion_20260901_020000_scheduled.dump');
      expect(row.passed).toBe(true);
      expect(row.ran_at).toBe(ranAt);
      expect(row.detail).toBeNull();
      // A filename, never a backup id: the drill record must outlive the
      // backup_metadata row that GFS retention will eventually prune.
      expect(row).not.toHaveProperty('backup_id');
    });

    it('stores the failure reason on a failing run', async () => {
      const createStub = sandbox.stub(BackupDrillEntity, 'create').resolves();

      await service.recordResult({
        backupFilename: 'pavillion_20260901_020000_scheduled.dump',
        passed: false,
        detail: 'failed checks: core tables non-empty',
      });

      const row = createStub.firstCall.args[0] as Record<string, unknown>;
      expect(row.passed).toBe(false);
      expect(row.detail).toBe('failed checks: core tables non-empty');
    });

    it('truncates an over-long detail rather than storing it whole', async () => {
      const createStub = sandbox.stub(BackupDrillEntity, 'create').resolves();

      await service.recordResult({
        backupFilename: 'a.dump',
        passed: false,
        detail: 'x'.repeat(DRILL_DETAIL_MAX_LENGTH + 250),
      });

      const row = createStub.firstCall.args[0] as Record<string, unknown>;
      expect((row.detail as string).length).toBe(DRILL_DETAIL_MAX_LENGTH);
    });
  });

  describe('getLastSuccessful', () => {
    it('asks for the newest passing run only', async () => {
      const findOneStub = sandbox.stub(BackupDrillEntity, 'findOne').resolves(
        BackupDrillEntity.build({
          id: '11111111-1111-4111-8111-111111111111',
          backup_filename: 'pavillion_20260901_020000_scheduled.dump',
          ran_at: new Date('2026-09-01T03:00:00Z'),
          passed: true,
          detail: null,
        }),
      );

      const record = await service.getLastSuccessful();

      // Failed runs are excluded, and the newest of what remains wins — a
      // failure after a success must not hide the successful drill.
      expect(findOneStub.firstCall.args[0]).toEqual({
        where: { passed: true },
        order: [['ran_at', 'DESC']],
      });
      // snake_case entity, camelCase boundary record.
      expect(record).toEqual({
        id: '11111111-1111-4111-8111-111111111111',
        backupFilename: 'pavillion_20260901_020000_scheduled.dump',
        ranAt: new Date('2026-09-01T03:00:00Z'),
        passed: true,
        detail: null,
      });
    });

    it('returns null when no drill has ever passed', async () => {
      sandbox.stub(BackupDrillEntity, 'findOne').resolves(null);

      expect(await service.getLastSuccessful()).toBeNull();
    });
  });
});
