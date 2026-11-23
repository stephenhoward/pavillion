import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { stripVTControlCharacters } from 'util';
import sinon from 'sinon';
import HousekeepingInterface from '@/server/housekeeping/interface';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import JobQueueService from '@/server/housekeeping/service/job-queue';
import StorageService from '@/server/housekeeping/service/storage';
import { BACKUP_JOB_EXPIRE_SECONDS } from '@/server/housekeeping/service/backup';
import DrillService from '@/server/housekeeping/service/drill';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import { BackupDrillEntity } from '@/server/housekeeping/entity/drill';
import { formatDrillStatus } from '@/server/cli/drill-status';
import * as fs from 'fs';
import * as os from 'os';
import {
  checkDumpMigrations,
  compareMigrationSets,
  dumpMigrationsInvocation,
  formatRestoreTarget,
  listCodeMigrations,
  parseDumpMigrations,
  pgRestoreInvocation,
  resolveRestoreConnection,
  restoreUsageError,
} from '@/server/cli/restore';

/**
 * CLI Commands Test Suite
 *
 * Exercises the HousekeepingInterface methods the management CLI relies on.
 * The CLI (src/server/cli/index.ts) routes every backup / job-queue operation
 * through this interface rather than reaching into housekeeping services or
 * entities directly (DEC-003 domain boundary), so these tests stand in for the
 * CLI command logic without spawning a process. Two guards that live above the
 * interface (the record-drill verdict allowlist and the interactive-only
 * restore) are exercised through a spawned CLI instead.
 */
describe('CLI Commands (HousekeepingInterface)', () => {
  let sandbox: sinon.SinonSandbox;
  let housekeeping: HousekeepingInterface;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const emailInterface = { sendMail: sandbox.stub() } as unknown as EmailInterface;
    const accountsInterface = new AccountsInterface();
    housekeeping = new HousekeepingInterface(emailInterface, accountsInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('backup create command', () => {
    it('should queue backup:create job through a self-managed queue', async () => {
      const startStub = sandbox.stub(JobQueueService.prototype, 'start').resolves();
      const stopStub = sandbox.stub(JobQueueService.prototype, 'stop').resolves();
      const publishStub = sandbox.stub(JobQueueService.prototype, 'publish').resolves('job-123');

      const jobId = await housekeeping.queueManualBackup();

      expect(jobId).toBe('job-123');
      expect(publishStub.calledOnce).toBe(true);
      expect(publishStub.firstCall.args[0]).toBe('backup:create');
      expect(publishStub.firstCall.args[1]).toEqual({ type: 'manual' });
      // The job's own expiry, not the queue's 60s default, bounds dump and copy.
      expect(publishStub.firstCall.args[2]).toEqual({ expireInSeconds: BACKUP_JOB_EXPIRE_SECONDS });
      // Queue lifecycle is owned by the interface, not the CLI.
      expect(startStub.calledOnce).toBe(true);
      expect(stopStub.calledOnce).toBe(true);
    });

    it('should stop the queue even when publishing fails', async () => {
      sandbox.stub(JobQueueService.prototype, 'start').resolves();
      const stopStub = sandbox.stub(JobQueueService.prototype, 'stop').resolves();
      sandbox.stub(JobQueueService.prototype, 'publish').rejects(new Error('boom'));

      await expect(housekeeping.queueManualBackup()).rejects.toThrow('boom');
      expect(stopStub.calledOnce).toBe(true);
    });
  });

  describe('backup list command', () => {
    it('should project backup entities onto boundary-safe records', async () => {
      const mockBackups = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          filename: 'pavillion_20260112_140530_manual.dump',
          size_bytes: 1024000,
          created_at: new Date('2026-01-12T14:05:30Z'),
          type: 'manual' as const,
          category: 'daily' as const,
          verified: true,
          storage_location: '/backups',
        },
        {
          id: '223e4567-e89b-12d3-a456-426614174001',
          filename: 'pavillion_20260111_020000_scheduled.dump',
          size_bytes: 2048000,
          created_at: new Date('2026-01-11T02:00:00Z'),
          type: 'scheduled' as const,
          category: 'weekly' as const,
          verified: true,
          storage_location: '/backups',
        },
      ] as BackupEntity[];

      sandbox.stub(StorageService.prototype, 'listBackups').resolves(mockBackups);

      const backups = await housekeeping.listBackups();

      expect(backups).toHaveLength(2);
      expect(backups[0]).toEqual({
        id: '123e4567-e89b-12d3-a456-426614174000',
        filename: 'pavillion_20260112_140530_manual.dump',
        sizeBytes: 1024000,
        createdAt: new Date('2026-01-12T14:05:30Z'),
        type: 'manual',
        category: 'daily',
        verified: true,
        storageLocation: '/backups',
      });
      expect(backups[1].category).toBe('weekly');
    });

    it('should return an empty array when no backups exist', async () => {
      sandbox.stub(StorageService.prototype, 'listBackups').resolves([]);

      const backups = await housekeeping.listBackups();

      expect(backups).toHaveLength(0);
    });
  });

  describe('backup status command', () => {
    it('should expose storage statistics', async () => {
      const mockStats = {
        totalSize: 10485760,
        count: 5,
        freeSpace: 50000000000,
        totalSpace: 100000000000,
        freeSpacePercent: 50,
      };

      sandbox.stub(StorageService.prototype, 'getStorageStats').resolves(mockStats);

      const stats = await housekeeping.getStorageStats();

      expect(stats.count).toBe(5);
      expect(stats.freeSpacePercent).toBe(50);
      expect(stats.totalSize).toBe(10485760);
    });

    it('should retrieve the last verified backup as a record', async () => {
      const mockBackup = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        filename: 'pavillion_20260112_140530_manual.dump',
        size_bytes: 1024000,
        created_at: new Date('2026-01-12T14:05:30Z'),
        type: 'manual' as const,
        category: 'daily' as const,
        verified: true,
        storage_location: '/backups',
      } as BackupEntity;

      const findOneStub = sandbox.stub(BackupEntity, 'findOne').resolves(mockBackup);

      const lastBackup = await housekeeping.getLastVerifiedBackup();

      expect(lastBackup).not.toBeNull();
      expect(lastBackup!.verified).toBe(true);
      expect(lastBackup!.sizeBytes).toBe(1024000);
      // Only verified backups are considered, newest first.
      expect(findOneStub.firstCall.args[0]).toEqual({
        where: { verified: true },
        order: [['created_at', 'DESC']],
      });
    });

    it('should return null when no verified backup exists', async () => {
      sandbox.stub(BackupEntity, 'findOne').resolves(null);

      const lastBackup = await housekeeping.getLastVerifiedBackup();

      expect(lastBackup).toBeNull();
    });

    /**
     * The drill section is what keeps an operator from reading the Last Backup
     * "Verified" mark — a write-time size check — as proof of restorability.
     */
    describe('last successful restore drill section', () => {
      const plain = (lines: string[]) => lines.map((line) => stripVTControlCharacters(line));

      it('should print the drill timestamp and the backup it restored', () => {
        const lines = plain(formatDrillStatus({
          id: '323e4567-e89b-12d3-a456-426614174002',
          backupFilename: 'pavillion_20260901_020000_scheduled.dump',
          // Local-time constructor: the CLI prints local time, as for backups.
          ranAt: new Date(2026, 8, 1, 3, 0, 0),
          passed: true,
          detail: null,
        }));

        expect(lines).toEqual([
          'Last Successful Restore Drill:',
          '  Date: 2026-09-01 03:00:00',
          '  Restored backup: pavillion_20260901_020000_scheduled.dump',
          '  ("Verified" on a backup means its file was written; only a drill proves it restores)',
        ]);
      });

      it('should say plainly when no drill has ever passed', () => {
        const lines = plain(formatDrillStatus(null));

        expect(lines).toEqual([
          'Last Successful Restore Drill:',
          '  No successful restore drill recorded — no backup has been proven restorable',
          '  (Run scripts/restore-drill.sh to prove one)',
          '  ("Verified" on a backup means its file was written; only a drill proves it restores)',
        ]);
      });
    });
  });

  describe('backup record-drill command', () => {
    it('should record a drill outcome through the domain boundary', async () => {
      const recordStub = sandbox.stub(DrillService.prototype, 'recordResult').resolves();

      await housekeeping.recordDrillResult({
        backupFilename: 'pavillion_20260901_020000_scheduled.dump',
        passed: false,
        detail: 'pg_restore failed',
      });

      expect(recordStub.calledOnce).toBe(true);
      expect(recordStub.firstCall.args[0]).toEqual({
        backupFilename: 'pavillion_20260901_020000_scheduled.dump',
        passed: false,
        detail: 'pg_restore failed',
      });
    });

    it('should project a drill entity onto a boundary-safe record', async () => {
      sandbox.stub(BackupDrillEntity, 'findOne').resolves(
        BackupDrillEntity.build({
          id: '323e4567-e89b-12d3-a456-426614174002',
          backup_filename: 'pavillion_20260901_020000_scheduled.dump',
          ran_at: new Date('2026-09-01T03:00:00Z'),
          passed: true,
          detail: null,
        }),
      );

      const drill = await housekeeping.getLastSuccessfulDrill();

      // camelCase out of a snake_case entity, as toBackupRecord does above.
      expect(drill).toEqual({
        id: '323e4567-e89b-12d3-a456-426614174002',
        backupFilename: 'pavillion_20260901_020000_scheduled.dump',
        ranAt: new Date('2026-09-01T03:00:00Z'),
        passed: true,
        detail: null,
      });
    });

    it('should return null when no drill has ever passed', async () => {
      sandbox.stub(BackupDrillEntity, 'findOne').resolves(null);

      expect(await housekeeping.getLastSuccessfulDrill()).toBeNull();
    });

    /**
     * One of the two tests in this file that spawn the CLI (the other is the
     * non-interactive restore refusal).
     *
     * The `--result` allowlist lives in handleBackupRecordDrill, above the
     * interface — commander accepts any string for `--result <result>`, so the
     * guard is the only thing between a typo and a drill stored under a third
     * verdict. Every other test here calls HousekeepingInterface directly, which
     * is deliberately the wrong side of that guard: `passed: options.result ===
     * 'pass'` means an unrecognised word would silently record as a FAILED
     * drill, and a run of those reads as "restores are broken" rather than "the
     * caller is broken". Exercising that needs the real argv path, and the
     * module runs main() on import, so it has to be a process.
     *
     * It is also cheap to keep honest: the rejection happens before
     * initDatabase, so nothing here touches a database — asserted below, because
     * a guard that fired after the connection was open would be a different
     * (and worse) guard.
     */
    it('should reject a verdict that is neither pass nor fail, before touching the database', async () => {
      const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolve) => {
          execFile(
            path.join(repoRoot, 'node_modules', '.bin', 'tsx'),
            [
              path.join('src', 'server', 'cli', 'index.ts'),
              'backup', 'record-drill',
              '--file', 'pavillion_20260901_020000_scheduled.dump',
              '--result', 'maybe',
            ],
            { cwd: repoRoot },
            (error, stdout, stderr) => {
              resolve({
                code: error ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) as number : 0,
                stdout,
                stderr,
              });
            },
          );
        },
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("--result must be 'pass' or 'fail'");
      expect(result.stderr).toContain('maybe');
      // No connection was opened, so no row could have been written.
      expect(result.stdout).not.toContain('Database connected');
      expect(result.stdout).not.toContain('Recorded');
    }, 60000);
  });

  describe('backup restore command', () => {
    it('should retrieve a single backup record by id', async () => {
      const mockBackup = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        filename: 'pavillion_20260112_140530_manual.dump',
        size_bytes: 1024000,
        created_at: new Date('2026-01-12T14:05:30Z'),
        type: 'manual' as const,
        category: 'daily' as const,
        verified: true,
        storage_location: '/backups',
      } as BackupEntity;

      sandbox.stub(StorageService.prototype, 'getBackup').resolves(mockBackup);

      const backup = await housekeeping.getBackup('123e4567-e89b-12d3-a456-426614174000');

      expect(backup).not.toBeNull();
      expect(backup!.id).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(backup!.verified).toBe(true);
      expect(backup!.storageLocation).toBe('/backups');
    });

    it('should return null when the backup id is unknown', async () => {
      sandbox.stub(StorageService.prototype, 'getBackup').resolves(null);

      const backup = await housekeeping.getBackup('missing-id');

      expect(backup).toBeNull();
    });

    const dbConfig = {
      host: 'db.internal',
      port: 6543,
      database: 'pavillion_prod',
      username: 'pavillion',
      password: 's3cr3t"; rm -rf / #',
    };

    it('should build pg_restore as an argument array with the password only in env', () => {
      const conn = resolveRestoreConnection(dbConfig);
      const { args, env } = pgRestoreInvocation(conn, '/backups/pavillion_20260112_140530_manual.dump');

      expect(args).toEqual([
        '-c',
        '--if-exists',
        '-h', 'db.internal',
        '-p', '6543',
        '-U', 'pavillion',
        '-d', 'pavillion_prod',
        '--', '/backups/pavillion_20260112_140530_manual.dump',
      ]);
      expect(env.PGPASSWORD).toBe(dbConfig.password);
      expect(args.some((arg) => arg.includes('s3cr3t'))).toBe(false);
    });

    it('should keep the rest of the process environment when setting PGPASSWORD', () => {
      const { env } = pgRestoreInvocation(resolveRestoreConnection(dbConfig), '/backups/x.dump');

      expect(env.PATH).toBe(process.env.PATH);
    });

    it('should fall back to default connection settings when config omits them', () => {
      const conn = resolveRestoreConnection({ database: 'pavillion', user: 'alt' });

      expect(conn).toEqual({
        host: 'localhost',
        port: 5432,
        database: 'pavillion',
        username: 'alt',
        password: '',
      });
    });

    it('should name the target database and host without the password', () => {
      const line = stripVTControlCharacters(formatRestoreTarget(resolveRestoreConnection(dbConfig)));

      expect(line).toContain('Target database: pavillion_prod on db.internal');
      expect(line).not.toContain('s3cr3t');
      expect(line).not.toContain('pavillion@');
    });

    /**
     * Spawns the CLI with `backup restore <args>` and pipes "yes" to its
     * stdin. The test process's stdin pipe is not a TTY, so the spawned CLI
     * sees exactly the `echo yes | docker exec -i ...` situation.
     */
    function runRestoreCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
      const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

      return new Promise((resolve) => {
        const child = execFile(
          path.join(repoRoot, 'node_modules', '.bin', 'tsx'),
          [path.join('src', 'server', 'cli', 'index.ts'), 'backup', 'restore', ...args],
          { cwd: repoRoot },
          (error, stdout, stderr) => {
            resolve({
              code: error ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) as number : 0,
              stdout,
              stderr: stripVTControlCharacters(stderr),
            });
          },
        );
        child.stdin?.end('yes\n');
      });
    }

    /**
     * Restore is interactive-only: piping "yes" into `docker exec -i` must not
     * satisfy the confirmation. The refusal fires before initDatabase, so no
     * connection is opened and pg_restore cannot run.
     */
    it('should refuse a restore when stdin is not a terminal, before touching the database', async () => {
      const result = await runRestoreCli(['123e4567-e89b-12d3-a456-426614174000']);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('interactive terminal');
      expect(result.stdout).not.toContain('Database connected');
      expect(result.stdout).not.toContain('Starting database restore');
    }, 60000);

    it('should refuse a --file restore when stdin is not a terminal, before touching the database', async () => {
      const result = await runRestoreCli(['--file', '/backups/pavillion_20260112_140530_manual.dump']);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('interactive terminal');
      expect(result.stdout).not.toContain('Database connected');
      expect(result.stdout).not.toContain('Starting database restore');
    }, 60000);

    it('should refuse a restore given neither an id nor --file, before the terminal check', async () => {
      const result = await runRestoreCli([]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('exactly one of');
      expect(result.stderr).not.toContain('interactive terminal');
      expect(result.stdout).not.toContain('Database connected');
    }, 60000);

    it('should refuse a restore given both an id and --file, before the terminal check', async () => {
      const result = await runRestoreCli(['123e4567-e89b-12d3-a456-426614174000', '--file', '/backups/x.dump']);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('exactly one of');
      expect(result.stderr).not.toContain('interactive terminal');
      expect(result.stdout).not.toContain('Database connected');
    }, 60000);
  });

  describe('backup restore usage', () => {
    it('should accept exactly one of an id or a file', () => {
      expect(restoreUsageError('123e4567-e89b-12d3-a456-426614174000', undefined)).toBeNull();
      expect(restoreUsageError(undefined, '/backups/x.dump')).toBeNull();
    });

    it('should reject neither and both', () => {
      expect(restoreUsageError(undefined, undefined)).toContain('exactly one of');
      expect(restoreUsageError('123e4567-e89b-12d3-a456-426614174000', '/backups/x.dump')).toContain('exactly one of');
    });
  });

  describe('backup restore --file migration check', () => {
    /**
     * Real `pg_restore --data-only --table=SequelizeMeta --file=-` output from
     * postgres:17, with a second table's COPY block appended to prove only the
     * SequelizeMeta block is read.
     */
    const PG17_OUTPUT = [
      '--',
      '-- PostgreSQL database dump',
      '--',
      '',
      '\\restrict py8B4ukiIXgmymUrKNfxTSzCiLlEmIsCkItoJeLVK1IApJEnnzY29gAnpYPcP30',
      '',
      '-- Dumped from database version 17.12 (Debian 17.12-1.pgdg13+1)',
      '-- Dumped by pg_dump version 17.12 (Debian 17.12-1.pgdg13+1)',
      '',
      'SET statement_timeout = 0;',
      'SET client_encoding = \'UTF8\';',
      'SELECT pg_catalog.set_config(\'search_path\', \'\', false);',
      '',
      '--',
      '-- Data for Name: SequelizeMeta; Type: TABLE DATA; Schema: public; Owner: postgres',
      '--',
      '',
      'COPY public."SequelizeMeta" (name) FROM stdin;',
      '0001_initial_schema.ts',
      '0002_complimentary_grants.ts',
      '\\.',
      '',
      '',
      'COPY public.account (id, email) FROM stdin;',
      '1\ta@b.c',
      '\\.',
      '',
      '--',
      '-- PostgreSQL database dump complete',
      '--',
      '',
      '\\unrestrict py8B4ukiIXgmymUrKNfxTSzCiLlEmIsCkItoJeLVK1IApJEnnzY29gAnpYPcP30',
      '',
    ].join('\n');

    it('should build the dump-reading invocation with no connection settings or password', () => {
      const { args } = dumpMigrationsInvocation('/backups/x.dump');

      expect(args).toEqual(['--data-only', '--table=SequelizeMeta', '--file=-', '--', '/backups/x.dump']);
      expect(args.indexOf('--')).toBe(args.length - 2);
    });

    it('should read the migration names from the SequelizeMeta COPY block only', () => {
      expect(parseDumpMigrations(PG17_OUTPUT)).toEqual([
        '0001_initial_schema.ts',
        '0002_complimentary_grants.ts',
      ]);
    });

    it('should return null when the output has no SequelizeMeta COPY block', () => {
      const withoutBlock = PG17_OUTPUT.replace('COPY public."SequelizeMeta" (name) FROM stdin;', '-- removed');

      expect(parseDumpMigrations(withoutBlock)).toBeNull();
      expect(parseDumpMigrations('')).toBeNull();
    });

    it('should return null when the COPY block is never terminated', () => {
      expect(parseDumpMigrations('COPY public."SequelizeMeta" (name) FROM stdin;\n0001_initial_schema.ts\n')).toBeNull();
    });

    it('should compare migration sets in both directions', () => {
      const code = ['0001_a.ts', '0002_b.ts'];

      expect(compareMigrationSets(code, ['0002_b.ts', '0001_a.ts'])).toEqual({ missing: [], extra: [] });
      expect(compareMigrationSets(code, ['0001_a.ts'])).toEqual({ missing: ['0002_b.ts'], extra: [] });
      expect(compareMigrationSets(code, ['0001_a.ts', '0002_b.ts', '0003_c.ts'])).toEqual({ missing: [], extra: ['0003_c.ts'] });
      expect(compareMigrationSets(code, ['0001_a.ts', '0003_c.ts'])).toEqual({ missing: ['0002_b.ts'], extra: ['0003_c.ts'] });
    });

    describe('listCodeMigrations', () => {
      let dir: string;

      beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-migrations-'));
      });

      afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
      });

      it('should list .ts and .js migrations, skipping declarations and other files', () => {
        for (const name of ['0002_b.ts', '0001_a.ts', 'x.d.ts', 'README.md']) {
          fs.writeFileSync(path.join(dir, name), '');
        }

        expect(listCodeMigrations(dir)).toEqual(['0001_a.ts', '0002_b.ts']);
      });

      it('should name the repository migrations as SequelizeMeta records them, extension included', () => {
        const names = listCodeMigrations(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../migrations'));

        expect(names).toContain('0001_initial_schema.ts');
        expect(names).not.toContain('README.md');
      });
    });

    describe('checkDumpMigrations', () => {
      const code = ['0001_a.ts', '0002_b.ts'];

      it('should refuse a dump with no migration record', () => {
        for (const dump of [null, []]) {
          const check = checkDumpMigrations(code, dump);

          expect(check.ok).toBe(false);
          expect(check.lines.join('\n')).toContain('not a Pavillion database dump, or it has no migration record');
        }
      });

      it('should refuse a dump newer than the code, listing the extra migrations', () => {
        const check = checkDumpMigrations(code, ['0001_a.ts', '0002_b.ts', '0003_c.ts']);
        const text = stripVTControlCharacters(check.lines.join('\n'));

        expect(check.ok).toBe(false);
        expect(text).toContain('0003_c.ts');
        expect(text).toContain('PAVILLION_IMAGE_TAG');
      });

      it('should refuse a dump that has migrations the code lacks even when it also lacks some', () => {
        expect(checkDumpMigrations(code, ['0001_a.ts', '0003_c.ts']).ok).toBe(false);
      });

      it('should warn about an older dump and continue', () => {
        const check = checkDumpMigrations(code, ['0001_a.ts']);
        const text = stripVTControlCharacters(check.lines.join('\n'));

        expect(check.ok).toBe(true);
        expect(text).toContain('1 migration');
        expect(text).toContain('next starts');
      });

      it('should report a match with the count', () => {
        const check = checkDumpMigrations(code, ['0002_b.ts', '0001_a.ts']);

        expect(check.ok).toBe(true);
        expect(stripVTControlCharacters(check.lines.join('\n'))).toContain('Migrations: match this version (2)');
      });

      it('should strip control characters from names supplied by the dump', () => {
        const check = checkDumpMigrations(code, ['0001_a.ts', '0002_b.ts', '0003_\u001b[2Jevil\u0007.ts']);
        const text = check.lines.join('\n');

        expect(text).toContain('0003_[2Jevil.ts');
        expect(text).not.toContain('\u0007');
        expect(text).not.toContain('\u001b[2J');
      });
    });
  });
});
