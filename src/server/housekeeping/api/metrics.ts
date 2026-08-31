import http from 'http';
import HousekeepingInterface, { OperationalMetrics } from '@/server/housekeeping/interface';
import { FAILED_JOB_WINDOW_HOURS } from '@/server/housekeeping/service/metrics';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('housekeeping');

/** OpenMetrics 1.0 exposition media type, as scrapers content-negotiate it. */
export const METRICS_CONTENT_TYPE = 'application/openmetrics-text; version=1.0.0; charset=utf-8';

/** The only path the metrics listener answers. */
export const METRICS_PATH = '/metrics';

/**
 * How long a rendered scrape is reused. Defense in depth against scrape
 * frequency abuse: the endpoint has no authentication of its own, so a caller
 * that reaches it must not be able to turn a scrape loop into repeated statfs
 * and aggregate-count queries against the database.
 */
export const DEFAULT_CACHE_TTL_MS = 10_000;

/**
 * Escapes a label value per the OpenMetrics text grammar. Queue labels come
 * from a fixed in-code list, so this can never fire today — it is here so a
 * future label source cannot produce an unparseable document.
 */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Renders one gauge family: the TYPE and HELP metadata plus its samples.
 * Emits nothing at all when there are no samples, which is how an absent
 * series stays absent rather than becoming a zero.
 */
function gauge(name: string, help: string, samples: { labels?: Record<string, string>, value: number }[]): string {
  if (samples.length === 0) {
    return '';
  }

  const lines = [`# TYPE ${name} gauge`, `# HELP ${name} ${help}`];

  for (const sample of samples) {
    const labels = sample.labels
      ? `{${Object.entries(sample.labels).map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(',')}}`
      : '';
    lines.push(`${name}${labels} ${sample.value}`);
  }

  return lines.join('\n') + '\n';
}

/** Convenience for a single unlabelled sample, or nothing when value is null. */
function scalarGauge(name: string, help: string, value: number | null | undefined): string {
  return gauge(name, help, value === null || value === undefined ? [] : [{ value }]);
}

/**
 * Renders the OpenMetrics exposition document for a set of collected metrics.
 *
 * This function is the field allow-list: every series below names the exact
 * interface field it reads. It never iterates or serialises the collector's
 * response, so a field added to {@link OperationalMetrics} for some other
 * consumer cannot silently become a published series — someone has to come
 * here and add it deliberately.
 *
 * Nothing here reads calendars, events, accounts, or visitors. Every series
 * describes the instance's own operation.
 *
 * @param metrics - Collected operational values
 * @returns A complete OpenMetrics text document, terminated by `# EOF`
 */
export function renderOpenMetrics(metrics: OperationalMetrics): string {
  const families = [
    scalarGauge(
      'pavillion_backup_last_success_timestamp_seconds',
      'Unix timestamp of the most recent verified database backup.',
      metrics.backup?.lastSuccessTimestampSeconds,
    ),
    scalarGauge(
      'pavillion_backup_last_success_size_bytes',
      'Size in bytes of the most recent verified database backup.',
      metrics.backup?.lastSuccessSizeBytes,
    ),
    scalarGauge(
      'pavillion_backup_volume_total_bytes',
      'Total size in bytes of the filesystem holding database backups.',
      metrics.backupVolume?.totalBytes,
    ),
    scalarGauge(
      'pavillion_backup_volume_free_bytes',
      'Bytes available to unprivileged users on the filesystem holding database backups.',
      metrics.backupVolume?.freeBytes,
    ),
    scalarGauge(
      'pavillion_backup_volume_used_bytes',
      'Bytes used on the filesystem holding database backups.',
      metrics.backupVolume?.usedBytes,
    ),
    scalarGauge(
      'pavillion_disk_snapshot_timestamp_seconds',
      'Unix timestamp at which the worker last measured the backup volume. Alert on this going stale: the backup volume figures are only as current as this value.',
      metrics.backupVolume?.snapshotTimestampSeconds,
    ),
    scalarGauge(
      'pavillion_database_size_bytes',
      'On-disk size in bytes of the application database.',
      metrics.databaseSizeBytes,
    ),
    scalarGauge(
      'pavillion_media_volume_total_bytes',
      'Total size in bytes of the filesystem holding uploaded media.',
      metrics.mediaVolume?.totalBytes,
    ),
    scalarGauge(
      'pavillion_media_volume_free_bytes',
      'Bytes available to unprivileged users on the filesystem holding uploaded media.',
      metrics.mediaVolume?.freeBytes,
    ),
    scalarGauge(
      'pavillion_media_volume_used_bytes',
      'Bytes used on the filesystem holding uploaded media.',
      metrics.mediaVolume?.usedBytes,
    ),
    gauge(
      'pavillion_queue_depth',
      'Background jobs waiting or running, by queue.',
      (metrics.queues ?? []).map((queue) => ({ labels: { queue: queue.queue }, value: queue.depth })),
    ),
    gauge(
      'pavillion_queue_failed_jobs',
      `Background jobs in the failed state within the last ${FAILED_JOB_WINDOW_HOURS} hours, by queue. The window is fixed: the job queue deletes rows one day after creation, so older failures are not observable. Counts only — no job identifier, payload, or error text is exposed.`,
      (metrics.queues ?? []).map((queue) => ({ labels: { queue: queue.queue }, value: queue.failedJobs })),
    ),
  ];

  return families.join('') + '# EOF\n';
}

/**
 * Handler for the operational metrics listener.
 *
 * Deliberately not an Express route on the main application: the app service
 * publishes its port on the host in the default deployment, so anything served
 * there is public. This runs on its own listener that compose does not
 * publish, which makes "private by default" a property of the code rather than
 * of a proxy configuration an operator may or may not be running.
 *
 * The listener binds 0.0.0.0 inside the container — the boundary is compose
 * non-publication, not the bind address, so a companion monitoring container on
 * the same network can still reach it.
 */
export default class MetricsRoutes {
  private housekeepingInterface: HousekeepingInterface;
  private cacheTtlMs: number;
  private cached: { body: string, expiresAt: number } | null = null;

  constructor(housekeepingInterface: HousekeepingInterface, cacheTtlMs: number = DEFAULT_CACHE_TTL_MS) {
    this.housekeepingInterface = housekeepingInterface;
    this.cacheTtlMs = cacheTtlMs;
    this.handleRequest = this.handleRequest.bind(this);
  }

  /**
   * Creates the HTTP server for the metrics listener. The caller owns
   * `listen`/`close` so startup and shutdown stay in one place.
   *
   * @returns An unstarted HTTP server bound to this handler
   */
  createServer(): http.Server {
    return http.createServer(this.handleRequest);
  }

  /**
   * Serves the exposition document.
   *
   * GET and HEAD only, and no CORS headers on any response: a browser page on
   * another origin must not be able to read an instance's operational
   * telemetry, and default-deny is achieved by never sending the header.
   *
   * @param req - Incoming request
   * @param res - Response to write
   */
  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const method = req.method ?? '';
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { 'Allow': 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method Not Allowed\n');
        return;
      }

      if ((req.url ?? '').split('?')[0] !== METRICS_PATH) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found\n');
        return;
      }

      const body = await this.renderCached();

      res.writeHead(200, {
        'Content-Type': METRICS_CONTENT_TYPE,
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      res.end(method === 'HEAD' ? undefined : body);
    }
    catch (error) {
      // Generic body: the detail belongs in the instance's own logs, not in a
      // response to a caller this endpoint cannot authenticate.
      logger.error({ err: error }, 'Failed to serve operational metrics');
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal Server Error\n');
    }
  }

  /**
   * Renders the exposition, reusing a recent render within the cache TTL.
   *
   * @returns The exposition document
   */
  private async renderCached(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.body;
    }

    const body = renderOpenMetrics(await this.housekeepingInterface.getOperationalMetrics());
    this.cached = { body, expiresAt: now + this.cacheTtlMs };
    return body;
  }
}
