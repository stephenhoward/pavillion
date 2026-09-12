import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Sequelize, QueryTypes } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import db from '@/server/common/entity/db';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import { BackupDrillEntity } from '@/server/housekeeping/entity/drill';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import HousekeepingInterface from '@/server/housekeeping/interface';
import migration from '../../../../../migrations/0044_create_backup_drill';

/**
 * Round-trip tests for the durable restore-drill record, against a real
 * database rather than stubbed entity statics.
 */
describe('Backup drill record', () => {
  let housekeeping: HousekeepingInterface;

  beforeAll(async () => {
    await db.sync({ force: true });
  });

  beforeEach(async () => {
    await BackupDrillEntity.destroy({ where: {}, truncate: true });
    await BackupEntity.destroy({ where: {}, truncate: true });
    housekeeping = new HousekeepingInterface(
      { sendMail: async () => {} } as unknown as EmailInterface,
      new AccountsInterface(),
    );
  });

  it('returns the newest passing drill and ignores failed runs', async () => {
    await housekeeping.recordDrillResult({ backupFilename: 'old-pass.dump', passed: true });
    await BackupDrillEntity.update(
      { ran_at: new Date('2026-07-01T02:00:00Z') },
      { where: { backup_filename: 'old-pass.dump' } },
    );

    await housekeeping.recordDrillResult({ backupFilename: 'newest-pass.dump', passed: true });
    await BackupDrillEntity.update(
      { ran_at: new Date('2026-08-01T02:00:00Z') },
      { where: { backup_filename: 'newest-pass.dump' } },
    );

    // The most recent run of all, and a failure — it must not become the
    // answer to "when did a restore last actually work".
    await housekeeping.recordDrillResult({
      backupFilename: 'later-fail.dump',
      passed: false,
      detail: 'failed checks: core tables non-empty',
    });
    await BackupDrillEntity.update(
      { ran_at: new Date('2026-09-01T02:00:00Z') },
      { where: { backup_filename: 'later-fail.dump' } },
    );

    const last = await housekeeping.getLastSuccessfulDrill();

    expect(last).not.toBeNull();
    expect(last!.backupFilename).toBe('newest-pass.dump');
    expect(last!.passed).toBe(true);
    expect(last!.ranAt).toEqual(new Date('2026-08-01T02:00:00Z'));
  });

  it('returns null when every recorded drill failed', async () => {
    await housekeeping.recordDrillResult({
      backupFilename: 'broken.dump',
      passed: false,
      detail: 'pg_restore failed',
    });

    expect(await housekeeping.getLastSuccessfulDrill()).toBeNull();
  });

  it('outlives the backup_metadata row it was recorded against', async () => {
    // GFS retention prunes backup_metadata, and a drill record must survive
    // that: the question the table exists to answer — when did a drill last
    // pass — would otherwise be erased by ordinary housekeeping. This is why
    // backup_filename carries no foreign key.
    const filename = 'pavillion_20260801_020000_scheduled.dump';
    await BackupEntity.create({
      id: uuidv4(),
      filename,
      size_bytes: 1024,
      created_at: new Date('2026-08-01T02:00:00Z'),
      type: 'scheduled',
      category: 'daily',
      verified: true,
      storage_location: '/backups',
    });

    await housekeeping.recordDrillResult({ backupFilename: filename, passed: true });

    await BackupEntity.destroy({ where: { filename } });
    expect(await BackupEntity.count()).toBe(0);

    const last = await housekeeping.getLastSuccessfulDrill();
    expect(last).not.toBeNull();
    expect(last!.backupFilename).toBe(filename);
    expect(last!.passed).toBe(true);
  });

  /**
   * What "survives a container restart" actually reduces to: the value lives in
   * the database, not in process memory or a module-level cache.
   *
   * This is NOT a restart test and does not claim to be one — restarting a
   * container is not something a test in this suite can do, and the rest of this
   * file runs against sqlite `:memory:`, which dies with its connection and so
   * could never show the property at all. What is proven here is the closest
   * honest equivalent available locally: the row is written through the
   * migration's own schema, the connection that wrote it is CLOSED, and a
   * brand-new connection to the same file reads it back. Nothing in the writing
   * process survives to serve the read.
   *
   * The complementary evidence, which this test cannot supply, is that the table
   * is created by a migration CI runs up and down against a real postgres:17.
   */
  it('persists across a closed and reopened database connection', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavillion-drill-'));
    const storage = path.join(dir, 'drill.sqlite');
    const id = uuidv4();

    try {
      const writer = new Sequelize({ dialect: 'sqlite', storage, logging: false });
      await migration.up({ context: writer });
      await writer.query(
        `INSERT INTO backup_drill (id, backup_filename, ran_at, passed, detail)
         VALUES ($id, 'pavillion_20260801_020000_scheduled.dump', '2026-08-01 02:00:00', 1, NULL)`,
        { bind: { id }, type: QueryTypes.INSERT },
      );
      await writer.close();

      const reader = new Sequelize({ dialect: 'sqlite', storage, logging: false });
      const rows = await reader.query<{ id: string; backup_filename: string; passed: number }>(
        'SELECT id, backup_filename, passed FROM backup_drill',
        { type: QueryTypes.SELECT },
      );
      await reader.close();

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(id);
      expect(rows[0].backup_filename).toBe('pavillion_20260801_020000_scheduled.dump');
      expect(Boolean(rows[0].passed)).toBe(true);
    }
    finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * The migration is reversible, which the CI migration smoke test exercises
   * against real Postgres. Asserted here too because a `down` that does not
   * really drop the table would fail that job long after the fact.
   */
  it('is created and dropped by a reversible migration', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavillion-drill-'));
    const storage = path.join(dir, 'reversible.sqlite');

    try {
      const sequelize = new Sequelize({ dialect: 'sqlite', storage, logging: false });
      const queryInterface = sequelize.getQueryInterface();

      await migration.up({ context: sequelize });
      expect(await queryInterface.showAllTables()).toContain('backup_drill');

      await migration.down({ context: sequelize });
      expect(await queryInterface.showAllTables()).not.toContain('backup_drill');

      // Both directions are idempotent — the helpers are what made the 0043
      // rename safe during the pv-7os2 renumbering.
      await migration.down({ context: sequelize });
      await migration.up({ context: sequelize });
      await migration.up({ context: sequelize });
      expect(await queryInterface.showAllTables()).toContain('backup_drill');

      await sequelize.close();
    }
    finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await BackupDrillEntity.destroy({ where: {}, truncate: true });
    await BackupEntity.destroy({ where: {}, truncate: true });
  });
});
