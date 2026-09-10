import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import config from 'config';
import { Client } from 'pg';

import db from '@/server/common/entity/db';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import DiskSnapshotService from '@/server/housekeeping/service/disk-snapshot';
import JobQueueService from '@/server/housekeeping/service/job-queue';
import MetricsService, { MONITORED_QUEUES } from '@/server/housekeeping/service/metrics';

/**
 * pg-boss job-count integration coverage.
 *
 * The unit suite cannot exercise this path at all: the test database is
 * SQLite, which has no `pgboss` schema. This suite stands a fake `pg.Client`
 * in front of a fixture job table and applies the predicates the production
 * SQL expresses — queue-name membership, the depth states, and the
 * `created_on >= $2` cutoff — to it. What it verifies is the part this
 * codebase owns and can regress: the cutoff MetricsService computes, the queue
 * list it asks for, and how the returned rows are folded back into per-queue
 * series. The SQL text itself is exercised only against real PostgreSQL.
 */

interface FixtureJob {
  name: string;
  state: string;
  created_on: Date;
}

/**
 * Evaluates the production query's predicates against a fixture job list,
 * using the bind parameters the caller actually passed.
 */
function aggregate(jobs: FixtureJob[], queueNames: string[], failedSince: Date) {
  const matched = jobs.filter((job) => queueNames.includes(job.name));
  const names = [...new Set(matched.map((job) => job.name))];

  return names.map((name) => {
    const forQueue = matched.filter((job) => job.name === name);
    return {
      name,
      depth: String(forQueue.filter((job) => ['created', 'retry', 'active'].includes(job.state)).length),
      failed: String(
        forQueue.filter((job) => job.state === 'failed' && job.created_on >= failedSince).length,
      ),
    };
  });
}

describe('pg-boss queue statistics', () => {
  let sandbox: sinon.SinonSandbox;
  let queryStub: sinon.SinonStub;
  let jobs: FixtureJob[];

  const postgresConfig = {
    dialect: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'pavillion',
    user: 'pavillion',
    password: 'secret',
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    jobs = [];

    // MetricsService builds its own JobQueueService from the ambient database
    // config, which is SQLite under test. Present a PostgreSQL deployment so
    // the queue path is reachable; every other config key falls through.
    const realGet = config.get.bind(config);
    sandbox.stub(config, 'get').callsFake((key: any) => (
      key === 'database' ? postgresConfig : realGet(key)
    ));

    // Silence the unrelated metric families so the queue behaviour is what the
    // assertions are reading.
    sandbox.stub(BackupEntity, 'findOne').resolves(null);
    sandbox.stub(DiskSnapshotService.prototype, 'getSnapshot').resolves(null);
    sandbox.stub(db, 'query').resolves([[], {}] as any);

    sandbox.stub(Client.prototype, 'connect').resolves();
    sandbox.stub(Client.prototype, 'end').resolves();
    queryStub = sandbox.stub(Client.prototype, 'query').callsFake(((_sql: string, params: any[]) => {
      const [queueNames, failedSince] = params;
      return Promise.resolve({ rows: aggregate(jobs, queueNames, failedSince) });
    }) as any);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('binds the queue list and the cutoff as parameters, never interpolated SQL', async () => {
    await new JobQueueService(postgresConfig).getQueueStats(['disk:check'], new Date('2026-08-30T12:00:00.000Z'));

    const [sql, params] = queryStub.firstCall.args;
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(sql).not.toContain('disk:check');
    expect(params).toEqual([['disk:check'], new Date('2026-08-30T12:00:00.000Z')]);
  });

  it('counts a failed job just inside the 24 hour window and not one just outside', async () => {
    const now = new Date('2026-08-31T12:00:00.000Z');
    jobs = [
      { name: 'backup:daily', state: 'failed', created_on: new Date('2026-08-30T12:01:00.000Z') },
      { name: 'backup:daily', state: 'failed', created_on: new Date('2026-08-30T11:59:00.000Z') },
    ];

    const metrics = await new MetricsService().collect(now);

    const backupQueue = metrics.queues!.find((queue) => queue.queue === 'backup:daily');
    expect(backupQueue!.failedJobs).toBe(1);
  });

  it('counts waiting, retrying and running jobs as queue depth', async () => {
    jobs = [
      { name: 'inbox:cleanup', state: 'created', created_on: new Date() },
      { name: 'inbox:cleanup', state: 'retry', created_on: new Date() },
      { name: 'inbox:cleanup', state: 'active', created_on: new Date() },
      { name: 'inbox:cleanup', state: 'completed', created_on: new Date() },
    ];

    const metrics = await new MetricsService().collect();

    const cleanupQueue = metrics.queues!.find((queue) => queue.queue === 'inbox:cleanup');
    expect(cleanupQueue!.depth).toBe(3);
  });

  it('reports zero for a monitored queue that has no rows at all', async () => {
    jobs = [{ name: 'disk:check', state: 'active', created_on: new Date() }];

    const metrics = await new MetricsService().collect();

    expect(metrics.queues!.map((queue) => queue.queue)).toEqual([...MONITORED_QUEUES]);
    const idle = metrics.queues!.find((queue) => queue.queue === 'notifications:cleanup');
    expect(idle).toEqual({ queue: 'notifications:cleanup', depth: 0, failedJobs: 0 });
  });

  it('refuses to guess queue state on a non-PostgreSQL deployment', async () => {
    const service = new JobQueueService({ dialect: 'sqlite', storage: ':memory:' });

    await expect(service.getQueueStats(['disk:check'], new Date())).rejects.toThrow(/PostgreSQL/);
  });
});
