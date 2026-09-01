import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

import { renderOpenMetrics, METRIC_FAMILY_PREFIXES } from '@/server/housekeeping/api/metrics';
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

/** Asserts a metric name belongs to one of the declared families. */
function expectDeclaredFamily(name: string): void {
  const prefix = METRIC_FAMILY_PREFIXES.find((candidate) => name.startsWith(candidate));
  expect(prefix, `${name} belongs to no declared metric family`).toBeDefined();
  // A bare prefix with nothing after it is not a metric name.
  expect(name.length).toBeGreaterThan(prefix!.length);
}

const fullMetrics: OperationalMetrics = {
  backup: { lastSuccessTimestampSeconds: 1756000000, lastSuccessSizeBytes: 5242880 },
  backupVolume: {
    volume: 'backups',
    totalBytes: 1000, freeBytes: 600, usedBytes: 400, snapshotTimestampSeconds: 1756003600,
  },
  // Measured live by the web process, so it carries no snapshot timestamp.
  mediaVolume: { volume: 'media', totalBytes: 500, freeBytes: 300, usedBytes: 200 },
  databaseSizeBytes: 78901234,
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

  it('names every rendered series inside a declared metric family', () => {
    const document = renderOpenMetrics(fullMetrics);

    // The `pavillion_` prefix alone is too weak an anchor: a name can carry it
    // and still invent a family nobody declared, which is how
    // pavillion_database_size_bytes drifted out of pavillion_db_*. The
    // families are the operator contract, so assert against them.
    const families = declaredFamilies(document);
    expect(families.length).toBeGreaterThan(0);
    for (const family of families) {
      expectDeclaredFamily(family);
    }
  });

  it('names every series in the source inside a declared metric family', () => {
    // The rendered-document check above only sees families the fixture
    // populates. A field added to the collector as null would satisfy the
    // compiler, render nothing, and silently exempt its series name from
    // review — so read the metric names straight out of the source instead.
    const source = readFileSync('src/server/housekeeping/api/metrics.ts', 'utf-8');

    // Anchored on the opening quote, so a `pavillion_disk_*` mention inside
    // help text or a comment is not mistaken for a metric name. Entries of
    // METRIC_FAMILY_PREFIXES itself end in the separating underscore; a metric
    // name never does, which is what tells the declaration from a use.
    const declared = [...source.matchAll(/'(pavillion_[a-z0-9_]+)'/g)]
      .map((match) => match[1])
      .filter((name) => !name.endsWith('_'));

    // Guard against the regex silently matching nothing.
    expect(declared.length).toBeGreaterThanOrEqual(declaredFamilies(renderOpenMetrics(fullMetrics)).length);
    for (const name of declared) {
      expectDeclaredFamily(name);
    }
  });

  it('puts every filesystem in one family regardless of which process read it', () => {
    const parsed = samples(renderOpenMetrics(fullMetrics));

    // The backup volume comes from a worker snapshot and the media volume from
    // a live statfs. That is an implementation fact, and it must not reach the
    // contract: both are the same physical quantity, so both are the same
    // series distinguished only by label.
    expect(parsed['pavillion_disk_used_bytes{volume="backups"}']).toBe(400);
    expect(parsed['pavillion_disk_used_bytes{volume="media"}']).toBe(200);
    expect(declaredFamilies(renderOpenMetrics(fullMetrics))).not.toContain('pavillion_media_volume_used_bytes');
  });

  it('certifies a volume with a timestamp under that volume own label', () => {
    const parsed = samples(renderOpenMetrics(fullMetrics));

    // The staleness series must be joinable to what it certifies: same family,
    // same label, so the operator's alert is a label match rather than a
    // memorised pairing of unrelated names.
    expect(parsed['pavillion_disk_snapshot_timestamp_seconds{volume="backups"}']).toBe(1756003600);
    expect(parsed['pavillion_disk_free_bytes{volume="backups"}']).toBe(600);
  });

  it('omits the timestamp for a volume measured live at scrape time', () => {
    const parsed = samples(renderOpenMetrics(fullMetrics));

    // Media is read live, so it has nothing to go stale. That is the ordinary
    // absent-series rule applied to one label value, not a special case.
    expect(parsed['pavillion_disk_snapshot_timestamp_seconds{volume="media"}']).toBeUndefined();
    expect(parsed['pavillion_disk_total_bytes{volume="media"}']).toBe(500);
  });

  it('drops only the absent volume label value, keeping the family', () => {
    const parsed = samples(renderOpenMetrics({ ...fullMetrics, mediaVolume: null }));

    // Object storage means there is no media filesystem to report. The family
    // survives on its other label value rather than vanishing.
    expect(parsed['pavillion_disk_total_bytes{volume="media"}']).toBeUndefined();
    expect(parsed['pavillion_disk_total_bytes{volume="backups"}']).toBe(1000);
  });

  it('adds a filesystem as a label value rather than a new series name', () => {
    const document = renderOpenMetrics({
      ...fullMetrics,
      mediaVolume: { ...fullMetrics.mediaVolume!, volume: 'archive' },
    });

    // A different filesystem changes only the label value, never the series
    // name — so monitoring another one cannot alter the identity of an
    // already-published series.
    expect(declaredFamilies(document)).toContain('pavillion_disk_total_bytes');
    expect(samples(document)['pavillion_disk_total_bytes{volume="archive"}']).toBe(500);
  });

  it('emits no filesystem path, only the volume label', () => {
    const document = renderOpenMetrics(fullMetrics);

    // DiskSnapshot carries `path` into the web process; it must never reach a
    // scrape. Host filesystem layout is not operational telemetry.
    expect(document).not.toContain('/backups');
    expect(document).not.toContain('path="');
    // Nor the snapshot table's own column vocabulary.
    expect(document).not.toContain('stat_key');
  });

  it('renders the collected values as their declared series', () => {
    const parsed = samples(renderOpenMetrics(fullMetrics));

    expect(parsed['pavillion_backup_last_success_timestamp_seconds']).toBe(1756000000);
    expect(parsed['pavillion_backup_last_success_size_bytes']).toBe(5242880);
    expect(parsed['pavillion_disk_total_bytes{volume="backups"}']).toBe(1000);
    expect(parsed['pavillion_disk_free_bytes{volume="backups"}']).toBe(600);
    expect(parsed['pavillion_disk_used_bytes{volume="backups"}']).toBe(400);
    expect(parsed['pavillion_disk_snapshot_timestamp_seconds{volume="backups"}']).toBe(1756003600);
    expect(parsed['pavillion_db_size_bytes']).toBe(78901234);
    expect(parsed['pavillion_disk_total_bytes{volume="media"}']).toBe(500);
    expect(parsed['pavillion_disk_free_bytes{volume="media"}']).toBe(300);
    expect(parsed['pavillion_disk_used_bytes{volume="media"}']).toBe(200);
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

    expect(parsed['pavillion_disk_total_bytes{volume="backups"}']).toBeUndefined();
    expect(parsed['pavillion_disk_snapshot_timestamp_seconds{volume="backups"}']).toBeUndefined();
    expect(declaredFamilies(document)).not.toContain('pavillion_queue_depth');
    expect(declaredFamilies(document)).not.toContain('pavillion_queue_failed_jobs');
  });

  it('keeps sibling metrics intact when one family is absent', () => {
    const parsed = samples(renderOpenMetrics({ ...fullMetrics, backupVolume: null, queues: null }));

    expect(parsed['pavillion_backup_last_success_size_bytes']).toBe(5242880);
    expect(parsed['pavillion_db_size_bytes']).toBe(78901234);
    expect(parsed['pavillion_disk_used_bytes{volume="media"}']).toBe(200);
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
