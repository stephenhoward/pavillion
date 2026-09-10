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
 * Ceiling on simultaneous connections to the metrics listener. helmet fronts
 * the Express app, not this server, and nothing else bounds a caller here; a
 * scraper needs one connection, so this is generous for every legitimate use
 * while capping how much socket state an unauthenticated caller can pin.
 */
export const MAX_CONNECTIONS = 32;

/**
 * Sent on every response. helmet does not reach this listener, so the one
 * header that matters for a text/plain body a browser might be tricked into
 * interpreting is set explicitly. Deliberately excludes CORS headers:
 * default-deny is achieved by never sending them.
 */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
} as const;

/**
 * The metric families this project has declared (DEC-017 rule 4).
 *
 * Every published series name must sit inside one of these. The families are
 * the operator contract, not merely the `pavillion_` prefix: a name outside
 * them is a family nobody agreed to, and renaming it after publication costs
 * a deprecation note plus an alert that quietly stops firing.
 *
 * Family membership follows what a series measures, never which process
 * measured it — so every filesystem is `pavillion_disk_*` whether the reading
 * came from a worker snapshot or a live statfs, and `pavillion_media_*` is
 * reserved for non-filesystem media quantities.
 *
 * `pavillion_federation_` is deliberately absent though DEC-017 reserves the
 * name: a future federation series should have to amend this declaration
 * rather than inherit permission from a reservation.
 *
 * Enforced at build time by the exposition test rather than at runtime. Every
 * name below is a static literal and no input can produce an undeclared one,
 * so a runtime check would re-validate a constant on every scrape.
 */
export const METRIC_FAMILY_PREFIXES = [
  'pavillion_backup_',
  'pavillion_disk_',
  'pavillion_db_',
  'pavillion_media_',
  'pavillion_queue_',
] as const;

/**
 * Escapes a label value per the OpenMetrics text grammar.
 *
 * Cannot fire today: both label sources are fixed in-code constants — queue
 * names from `MONITORED_QUEUES`, volume names from the `*_VOLUME_LABEL`
 * constants the collector emits directly. Nothing read back from the database
 * reaches a label. This exists so a future label source cannot produce an
 * unparseable document.
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
 * Every name sits inside one of the {@link METRIC_FAMILY_PREFIXES} families,
 * which is the operator contract these names freeze into once the guide
 * publishes them.
 *
 * Nothing here reads calendars, events, accounts, or visitors. Every series
 * describes the instance's own operation. No filesystem path is emitted
 * either: volumes carry a fixed in-code label name.
 *
 * @param metrics - Collected operational values
 * @returns A complete OpenMetrics text document, terminated by `# EOF`
 */
export function renderOpenMetrics(metrics: OperationalMetrics): string {
  // Every filesystem lands in one labelled family regardless of which process
  // read it, so monitoring another one is additive — a new label value, not a
  // new series name. Naming both fields here keeps the allow-list explicit: a
  // third volume has to be added deliberately.
  // Nullish rather than strictly null: a caller handing over a partial object
  // should lose one label value, not the whole scrape.
  const volumes = [metrics.backupVolume, metrics.mediaVolume]
    .filter((volume): volume is NonNullable<typeof volume> => volume != null);

  const volumeSamples = (read: (volume: (typeof volumes)[number]) => number | undefined) =>
    volumes.flatMap((volume) => {
      const value = read(volume);
      return value === undefined ? [] : [{ labels: { volume: volume.volume }, value }];
    });

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
    gauge(
      'pavillion_disk_total_bytes',
      'Total size in bytes of a monitored filesystem, by volume.',
      volumeSamples((volume) => volume.totalBytes),
    ),
    gauge(
      'pavillion_disk_free_bytes',
      'Bytes available to unprivileged users on a monitored filesystem, by volume.',
      volumeSamples((volume) => volume.freeBytes),
    ),
    gauge(
      'pavillion_disk_used_bytes',
      'Bytes used on a monitored filesystem, by volume.',
      volumeSamples((volume) => volume.usedBytes),
    ),
    gauge(
      'pavillion_disk_snapshot_timestamp_seconds',
      'Unix timestamp at which a background worker last measured this volume. The other pavillion_disk_* series for the same volume are only as current as this value — alert on it going stale. Absent for a volume the application measures live at scrape time, whose figures are always current.',
      volumeSamples((volume) => volume.snapshotTimestampSeconds),
    ),
    scalarGauge(
      'pavillion_db_size_bytes',
      'On-disk size in bytes of the application database.',
      metrics.databaseSizeBytes,
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
 * The listener binds the configured address (0.0.0.0 inside the container) —
 * the boundary is compose non-publication, not the bind address, so a
 * companion monitoring container on the same network can still reach it.
 *
 * The surface is versionless (`api/metrics.ts`, not `api/v1/`) on purpose.
 * What an operator's alert rules bind to is the metric names, not the URL:
 * scrapers configure a path once and key everything on series identity, so
 * versioning the path would move the contract to where nothing reads it while
 * leaving the names — the thing that actually cannot change — unversioned.
 */
export default class MetricsRoutes {
  private housekeepingInterface: HousekeepingInterface;
  private cacheTtlMs: number;
  // Holds the in-flight render, not the finished string, so concurrent misses
  // share one collection. See renderCached.
  private cached: { body: Promise<string>, expiresAt: number } | null = null;

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
    const server = http.createServer(this.handleRequest);
    server.maxConnections = MAX_CONNECTIONS;
    return server;
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
        res.writeHead(405, {
          'Allow': 'GET, HEAD',
          'Content-Type': 'text/plain; charset=utf-8',
          ...SECURITY_HEADERS,
        });
        res.end('Method Not Allowed\n');
        return;
      }

      if ((req.url ?? '').split('?')[0] !== METRICS_PATH) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
        res.end('Not Found\n');
        return;
      }

      const body = await this.renderCached();

      res.writeHead(200, {
        'Content-Type': METRICS_CONTENT_TYPE,
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        ...SECURITY_HEADERS,
      });
      res.end(method === 'HEAD' ? undefined : body);
    }
    catch (error) {
      // Generic body: the detail belongs in the instance's own logs, not in a
      // response to a caller this endpoint cannot authenticate.
      logger.error({ err: error }, 'Failed to serve operational metrics');
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      }
      res.end('Internal Server Error\n');
    }
  }

  /**
   * Renders the exposition, reusing a recent render within the cache TTL.
   *
   * The cache slot holds the in-flight promise rather than the finished
   * string, so concurrent scrapes that arrive during a miss all await one
   * collection. Caching only the settled value would let N simultaneous
   * requests each run a full collection — and a collection opens a raw,
   * unpooled PostgreSQL connection for the pg-boss counts, so enough parallel
   * scrapes could exhaust max_connections and starve the main application.
   * That is the cheaper version of exactly the abuse this cache exists to
   * prevent.
   *
   * A failed collection clears the slot rather than being cached: a stale
   * render served as if current would defeat the snapshot-staleness signal
   * this endpoint publishes.
   *
   * @returns The exposition document
   */
  private renderCached(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.body;
    }

    const body = this.housekeepingInterface.getOperationalMetrics().then(renderOpenMetrics);
    const slot = { body, expiresAt: now + this.cacheTtlMs };
    this.cached = slot;

    // Do not let a failure stick around until the TTL expires. The rejection
    // is still delivered to every awaiting caller; this handler only evicts.
    body.catch(() => {
      if (this.cached === slot) {
        this.cached = null;
      }
    });

    return body;
  }
}
