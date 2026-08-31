import { describe, it, expect } from 'vitest';

import { renderOpenMetrics } from '@/server/housekeeping/api/metrics';
import { OperationalMetrics } from '@/server/housekeeping/service/metrics';

/**
 * Parses an exposition document into the sample lines it declares, so tests
 * assert on what a scraper would read rather than on string formatting.
 */
function samples(document: string): Record<string, number> {
  const parsed: Record<string, number> = {};
  for (const line of document.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const separator = line.lastIndexOf(' ');
    parsed[line.slice(0, separator)] = Number(line.slice(separator + 1));
  }
  return parsed;
}

/** Metric family names declared by a `# TYPE` line. */
function declaredFamilies(document: string): string[] {
  return document
    .split('\n')
    .filter((line) => line.startsWith('# TYPE '))
    .map((line) => line.split(' ')[2]);
}

const fullMetrics: OperationalMetrics = {
  backup: { lastSuccessTimestampSeconds: 1756000000, lastSuccessSizeBytes: 5242880 },
  backupVolume: {
    totalBytes: 1000, freeBytes: 600, usedBytes: 400, snapshotTimestampSeconds: 1756003600,
  },
  databaseSizeBytes: 78901234,
  mediaVolume: { totalBytes: 500, freeBytes: 300, usedBytes: 200 },
  queues: [
    { queue: 'backup:daily', depth: 0, failedJobs: 2 },
    { queue: 'disk:check', depth: 1, failedJobs: 0 },
  ],
};

const emptyMetrics: OperationalMetrics = {
  backup: null,
  backupVolume: null,
  databaseSizeBytes: null,
  mediaVolume: null,
  queues: null,
};

describe('OpenMetrics exposition', () => {
  it('renders a valid document: every sample has a TYPE, and it ends with EOF', () => {
    const document = renderOpenMetrics(fullMetrics);

    expect(document.endsWith('# EOF\n')).toBe(true);

    const declared = declaredFamilies(document);
    for (const series of Object.keys(samples(document))) {
      const family = series.split('{')[0];
      expect(declared).toContain(family);
    }
    // Every family declares HELP as well as TYPE.
    for (const family of declared) {
      expect(document).toContain(`# HELP ${family} `);
    }
  });

  it('names every series under the pavillion_ prefix', () => {
    const document = renderOpenMetrics(fullMetrics);

    const families = declaredFamilies(document);
    expect(families.length).toBeGreaterThan(0);
    expect(families.every((family) => family.startsWith('pavillion_'))).toBe(true);
  });

  it('renders the collected values as their declared series', () => {
    const parsed = samples(renderOpenMetrics(fullMetrics));

    expect(parsed['pavillion_backup_last_success_timestamp_seconds']).toBe(1756000000);
    expect(parsed['pavillion_backup_last_success_size_bytes']).toBe(5242880);
    expect(parsed['pavillion_backup_volume_total_bytes']).toBe(1000);
    expect(parsed['pavillion_backup_volume_free_bytes']).toBe(600);
    expect(parsed['pavillion_backup_volume_used_bytes']).toBe(400);
    expect(parsed['pavillion_disk_snapshot_timestamp_seconds']).toBe(1756003600);
    expect(parsed['pavillion_database_size_bytes']).toBe(78901234);
    expect(parsed['pavillion_media_volume_total_bytes']).toBe(500);
    expect(parsed['pavillion_media_volume_free_bytes']).toBe(300);
    expect(parsed['pavillion_media_volume_used_bytes']).toBe(200);
    expect(parsed['pavillion_queue_depth{queue="disk:check"}']).toBe(1);
    expect(parsed['pavillion_queue_failed_jobs{queue="backup:daily"}']).toBe(2);
  });

  it('documents the failed-job window in help text rather than in the metric name', () => {
    const document = renderOpenMetrics(fullMetrics);

    const help = document.split('\n').find((line) => line.startsWith('# HELP pavillion_queue_failed_jobs '));
    expect(help).toContain('24 hours');
  });

  it('emits no series at all when no metric has data yet', () => {
    const document = renderOpenMetrics(emptyMetrics);

    expect(samples(document)).toEqual({});
    expect(declaredFamilies(document)).toEqual([]);
    // A scraper still gets a well-formed, empty document.
    expect(document).toBe('# EOF\n');
  });

  it('omits a family whose source failed without defaulting it to zero', () => {
    const document = renderOpenMetrics({ ...fullMetrics, backupVolume: null, queues: null });
    const parsed = samples(document);

    expect(parsed['pavillion_backup_volume_total_bytes']).toBeUndefined();
    expect(parsed['pavillion_disk_snapshot_timestamp_seconds']).toBeUndefined();
    expect(declaredFamilies(document)).not.toContain('pavillion_queue_depth');
    expect(declaredFamilies(document)).not.toContain('pavillion_queue_failed_jobs');
  });

  it('keeps sibling metrics intact when one family is absent', () => {
    const parsed = samples(renderOpenMetrics({ ...fullMetrics, backupVolume: null, queues: null }));

    expect(parsed['pavillion_backup_last_success_size_bytes']).toBe(5242880);
    expect(parsed['pavillion_database_size_bytes']).toBe(78901234);
    expect(parsed['pavillion_media_volume_used_bytes']).toBe(200);
  });

  it('renders a genuine zero, distinguishing it from an absent series', () => {
    const parsed = samples(renderOpenMetrics(fullMetrics));

    // backup:daily has no queued work, which the query measured as zero.
    expect(parsed['pavillion_queue_depth{queue="backup:daily"}']).toBe(0);
  });

  it('publishes nothing beyond its allow-list when the collector grows a field', () => {
    const withExtraField = {
      ...fullMetrics,
      // A field a future admin-UI convenience might add to the collector.
      adminContactEmail: 'admin@example.com',
      calendarCount: 42,
    } as unknown as OperationalMetrics;

    const document = renderOpenMetrics(withExtraField);

    expect(document).not.toContain('admin@example.com');
    expect(document).not.toContain('calendar');
    expect(declaredFamilies(document).length).toBe(declaredFamilies(renderOpenMetrics(fullMetrics)).length);
  });
});
