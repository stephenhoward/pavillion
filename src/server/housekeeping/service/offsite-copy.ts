import * as path from 'path';
import config from 'config';
import { createLogger } from '@/server/common/helper/logger';
import type { OffsiteDestination } from '@/server/housekeeping/service/offsite/destination';
import S3Destination from '@/server/housekeeping/service/offsite/s3';

const logger = createLogger('housekeeping');

/** Prefix every remote copy is stored under; a destination expiry rule targets it. */
export const OFFSITE_KEY_PREFIX = 'pavillion-backups/';

const FAILURE_MESSAGE = 'Off-host backup copy failed';
const REDACTED = '[redacted]';

/**
 * Destination types, keyed by `housekeeping.backup.offsite.driver`. Each
 * builder returns null when its target is not configured, which keeps the copy
 * off. Adding a destination type is one entry here and one OffsiteDestination
 * implementation under `service/offsite/`.
 */
const DESTINATIONS: Readonly<Record<string, () => OffsiteDestination | null>> = {
  s3: () => S3Destination.fromConfig(),
};

/** A driver value that looks like a driver name, and so is safe to echo into logs. */
const DRIVER_NAME = /^[a-z0-9_-]{1,32}$/;

/**
 * The driver as it may appear in a log line. A value that is not shaped like
 * a driver name could be anything an operator pasted into the wrong key, so it
 * is never echoed.
 */
function loggableDriver(driver: string): string {
  return DRIVER_NAME.test(driver) ? driver : '(invalid value)';
}

/**
 * Stands in for a driver that names no destination type: it carries the
 * configuration error, so the service reports it like any other, and writes
 * nothing.
 */
function unsupportedDestination(driver: string): OffsiteDestination {
  const supported = Object.keys(DESTINATIONS).join(', ');
  const configError = `Off-host copy driver "${loggableDriver(driver)}" is not supported (supported: ${supported})`;
  return {
    configError,
    logFields: {},
    secrets: [],
    put: () => Promise.reject(Object.assign(new Error(configError), { name: 'OffsiteConfigError' })),
  };
}

/**
 * Copies a completed local backup dump to the configured off-host destination.
 *
 * **Never rejects.** `copy()` resolves `true` on success and `false` on any
 * failure, including an invalid configuration, an unknown driver, a missing
 * file and a rejected or stalled write. This diverges from the usual
 * convention of throwing a domain exception, because an off-host copy failing
 * must never fail the backup it copies: the local dump is already written and
 * recorded. A failure is logged at error level instead, with a fixed message
 * and a whitelist of fields from which the destination's secrets are redacted.
 *
 * **Retention.** The application never deletes off-host copies, and they do
 * not follow the local retention policy; OffsiteDestination is write-only for
 * the reason given there. Expiry is the destination's own rule on the
 * `pavillion-backups/` prefix, which the operator must configure.
 */
export default class OffsiteCopyService {
  /** Why the configuration cannot be used, or null when it can. */
  readonly configError: string | null;

  /** The configured driver as it appears in log lines. */
  private readonly driver: string;

  /**
   * @param driver - The configured destination type, named in every log line
   * @param destination - The destination to write to
   */
  constructor(driver: string, private readonly destination: OffsiteDestination) {
    this.driver = loggableDriver(driver);
    this.configError = destination.configError;
  }

  /**
   * Builds the service from `housekeeping.backup.offsite`, or returns null when
   * the selected destination has no target configured. An invalid
   * configuration, including an unknown driver, does not throw: the instance
   * carries a `configError` and every copy fails.
   */
  static fromConfig(): OffsiteCopyService | null {
    const driver = String(config.get('housekeeping.backup.offsite.driver') ?? '').trim();
    const destination = Object.prototype.hasOwnProperty.call(DESTINATIONS, driver)
      ? DESTINATIONS[driver]()
      : unsupportedDestination(driver);
    return destination ? new OffsiteCopyService(driver, destination) : null;
  }

  /**
   * Logs one line saying whether the copy is on and where it goes, or the
   * configuration error. Never logs a credential value.
   */
  logStartup(): void {
    if (this.configError) {
      logger.error(
        { ...this.targetFields(), configError: this.configError },
        'Off-host backup copy is misconfigured; copies will fail',
      );
      return;
    }
    logger.info(this.targetFields(), 'Off-host backup copy enabled');
  }

  /**
   * Writes one local dump to `pavillion-backups/<basename>` at the destination.
   *
   * @param localPath - Full path of the dump on disk
   * @returns true when the copy was stored, false on any failure
   */
  async copy(localPath: string): Promise<boolean> {
    let filename = '';

    try {
      filename = path.basename(localPath);

      if (this.configError) {
        this.logFailure(filename, { name: 'OffsiteConfigError', message: this.configError });
        return false;
      }

      const abort = new AbortController();
      await this.destination.put(localPath, OFFSITE_KEY_PREFIX + filename, abort.signal);
      return true;
    }
    catch (error) {
      this.logFailure(filename, error);
      return false;
    }
  }

  /**
   * The destination's own fields plus the driver, for every log line. The
   * service's keys are set last, so a destination cannot overwrite them.
   */
  private targetFields(): Record<string, string> {
    return { ...this.destination.logFields, driver: this.driver };
  }

  /**
   * Logs a failed copy with only whitelisted fields. The raw error is never
   * passed to the logger. `code` covers Node system errors, and `Code` and
   * `$metadata` the AWS SDK's service errors; an error of another shape leaves
   * those fields undefined.
   */
  private logFailure(filename: string, error: unknown): void {
    const err = (typeof error === 'object' && error !== null ? error : {}) as Record<string, any>;
    const code = err.Code ?? err.code;
    const httpStatus = err.$metadata?.httpStatusCode;

    logger.error(
      {
        ...this.targetFields(),
        filename,
        errorName: this.redact(typeof err.name === 'string' ? err.name : undefined),
        errorCode: this.redact(code === undefined || code === null ? undefined : String(code)),
        httpStatus: typeof httpStatus === 'number' ? httpStatus : undefined,
        errorMessage: this.redact(typeof err.message === 'string' ? err.message : String(error)),
      },
      FAILURE_MESSAGE,
    );
  }

  /** Replaces every configured secret in the value; empty secrets are never matched. */
  private redact(value: string | undefined): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    return this.destination.secrets.reduce((result, secret) => result.split(secret).join(REDACTED), value);
  }
}
