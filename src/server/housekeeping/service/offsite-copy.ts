import * as fs from 'fs';
import * as path from 'path';
import { PassThrough } from 'stream';
import config from 'config';
import { PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('housekeeping');

/** Prefix every remote copy is stored under; a bucket lifecycle rule expires it. */
export const OFFSITE_KEY_PREFIX = 'pavillion-backups/';

/** Time allowed to open a connection to the store before the attempt fails. */
export const OFFSITE_CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Socket inactivity limit. It is an idle timer, so a slow upload that keeps
 * moving is unaffected; without it a store that accepts and never answers
 * leaves `copy()` pending forever.
 */
export const OFFSITE_SOCKET_TIMEOUT_MS = 60_000;

const FAILURE_MESSAGE = 'Off-host backup copy failed';
const REDACTED = '[redacted]';

/**
 * Hostnames for which a plain-http endpoint is accepted, for local testing.
 * Compared literally: no ranges, no suffix matching.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

/** The `housekeeping.backup.offsite.s3` settings, with absent keys as empty. */
export interface OffsiteS3Settings {
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function readSettings(): OffsiteS3Settings {
  const raw = config.get<Partial<OffsiteS3Settings>>('housekeeping.backup.offsite.s3') ?? {};
  return {
    bucket: (raw.bucket ?? '').trim(),
    region: (raw.region ?? '').trim(),
    endpoint: (raw.endpoint ?? '').trim(),
    accessKeyId: raw.accessKeyId ?? '',
    secretAccessKey: raw.secretAccessKey ?? '',
  };
}

/**
 * Returns why the settings cannot be used, or null when they can. The message
 * never echoes a configured value, so it is safe to log.
 */
function validateSettings(settings: OffsiteS3Settings): string | null {
  if (Boolean(settings.accessKeyId) !== Boolean(settings.secretAccessKey)) {
    return 'Set both BACKUP_S3_ACCESS_KEY and BACKUP_S3_SECRET_KEY, or neither to use the default credential chain';
  }

  if (settings.endpoint) {
    let url: URL;
    try {
      url = new URL(settings.endpoint);
    }
    catch {
      return 'BACKUP_S3_ENDPOINT is not a valid URL';
    }
    if (url.username || url.password) {
      return 'BACKUP_S3_ENDPOINT must not contain credentials';
    }
    const loopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
    if (url.protocol !== 'https:' && !loopbackHttp) {
      return 'BACKUP_S3_ENDPOINT must use https (http is accepted only for localhost or 127.0.0.1)';
    }
  }

  return null;
}

/** Hostname to name in logs: the endpoint's host, or "AWS" when none is set. */
function endpointHostOf(endpoint: string): string {
  if (!endpoint) {
    return 'AWS';
  }
  try {
    return new URL(endpoint).hostname;
  }
  catch {
    return 'invalid endpoint';
  }
}

/**
 * Builds the S3 client configuration from the off-host copy settings.
 *
 * The credentials key is omitted, not set to undefined, when no keys are
 * configured, so the SDK's default credential chain applies.
 */
export function buildClientConfig(settings: OffsiteS3Settings): S3ClientConfig {
  const clientConfig: S3ClientConfig = {
    region: settings.region || 'us-east-1',
    forcePathStyle: Boolean(settings.endpoint),
    maxAttempts: 3,
    requestHandler: {
      connectionTimeout: OFFSITE_CONNECTION_TIMEOUT_MS,
      socketTimeout: OFFSITE_SOCKET_TIMEOUT_MS,
    },
  };
  if (settings.endpoint) {
    clientConfig.endpoint = settings.endpoint;
  }
  if (settings.accessKeyId && settings.secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    };
  }
  return clientConfig;
}

/**
 * Copies a completed local backup dump to a configured S3-compatible bucket.
 *
 * **Never rejects.** `copy()` resolves `true` on success and `false` on any
 * failure, including an invalid configuration, a missing file, a read error
 * on the file stream and a rejected or stalled upload. This diverges from the
 * usual convention of throwing a domain exception, because an off-host copy
 * failing must never fail the backup it copies: the local dump is already
 * written and recorded. A failure is logged at error level instead, with a
 * fixed message and a whitelist of fields from which the configured keys are
 * redacted.
 *
 * The upload is one PutObject of a file stream. The client is configured with
 * three attempts, but the SDK does not retry a streaming body, so in practice a
 * failed copy is not retried; the next backup makes a fresh copy.
 *
 * **Retention.** The application never deletes from the bucket, and remote
 * copies do not follow the local retention policy. A host key that could
 * delete remote objects would let a compromise of the host, or a retention
 * bug, destroy both copies. Expiry is a bucket lifecycle rule on the
 * `pavillion-backups/` prefix, which the operator must configure.
 */
export default class OffsiteCopyService {
  /** Why the configuration cannot be used, or null when it can. */
  readonly configError: string | null;

  private readonly bucket: string;
  private readonly endpointHost: string;
  private readonly usesStaticKeys: boolean;
  private readonly secrets: string[];
  private readonly client: S3Client | null;

  private constructor(settings: OffsiteS3Settings, client: S3Client | undefined) {
    this.configError = validateSettings(settings);
    this.bucket = settings.bucket;
    this.endpointHost = endpointHostOf(settings.endpoint);
    this.usesStaticKeys = Boolean(settings.accessKeyId && settings.secretAccessKey);
    this.secrets = [settings.accessKeyId, settings.secretAccessKey].filter((value) => value.length > 0);
    this.client = this.configError
      ? null
      : client ?? new S3Client(buildClientConfig(settings));
  }

  /**
   * Builds the service from `housekeeping.backup.offsite.s3`, or returns null
   * when no bucket is configured. An invalid configuration does not throw: the
   * instance carries a `configError` and every copy fails.
   *
   * @param client - Injected S3 client, for tests
   */
  static fromConfig(client?: S3Client): OffsiteCopyService | null {
    const settings = readSettings();
    if (!settings.bucket) {
      return null;
    }
    return new OffsiteCopyService(settings, client);
  }

  /**
   * Logs one line saying whether the copy is on and how it authenticates, or
   * the configuration error. Never logs a credential value.
   */
  logStartup(): void {
    if (this.configError) {
      logger.error(
        { bucket: this.bucket, endpointHost: this.endpointHost, configError: this.configError },
        'Off-host backup copy is misconfigured; copies will fail',
      );
      return;
    }
    logger.info(
      {
        bucket: this.bucket,
        endpointHost: this.endpointHost,
        credentialSource: this.usesStaticKeys ? 'static keys' : 'default credential chain',
      },
      'Off-host backup copy enabled',
    );
  }

  /**
   * Uploads one local dump to `pavillion-backups/<basename>`.
   *
   * @param localPath - Full path of the dump on disk
   * @returns true when the object was stored, false on any failure
   */
  async copy(localPath: string): Promise<boolean> {
    let source: fs.ReadStream | undefined;
    let body: PassThrough | undefined;
    let filename = '';

    try {
      filename = path.basename(localPath);

      if (this.configError || !this.client) {
        this.logFailure(filename, { name: 'OffsiteConfigError', message: this.configError ?? 'No client' });
        return false;
      }

      const { size } = await fs.promises.stat(localPath);

      // A read error on the file stream is an 'error' event, which a try does
      // not catch and which the SDK re-raises on its own wrapper stream. Piping
      // into a PassThrough keeps the error on the source, where it aborts the
      // request and settles the race below instead of escaping as an
      // uncaughtException.
      source = fs.createReadStream(localPath);
      body = source.pipe(new PassThrough());
      const abort = new AbortController();
      const readFailed = new Promise<never>((_, reject) => {
        source!.on('error', (error) => {
          abort.abort();
          reject(error);
        });
      });
      // Mark the rejection handled for the paths that never reach the race
      // (send throwing synchronously) or settle it first (a read error after
      // the stream is destroyed); the race still sees it.
      readFailed.catch(() => {});

      await Promise.race([
        this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: OFFSITE_KEY_PREFIX + filename,
            Body: body,
            ContentLength: size,
          }),
          { abortSignal: abort.signal },
        ),
        readFailed,
      ]);

      return true;
    }
    catch (error) {
      this.logFailure(filename, error);
      return false;
    }
    finally {
      source?.destroy();
      body?.destroy();
    }
  }

  /**
   * Logs a failed copy with only whitelisted fields. The raw error, its
   * `$metadata` and `$response` are never passed to the logger.
   */
  private logFailure(filename: string, error: unknown): void {
    const err = (typeof error === 'object' && error !== null ? error : {}) as Record<string, any>;
    const code = err.Code ?? err.code;
    const httpStatus = err.$metadata?.httpStatusCode;

    logger.error(
      {
        filename,
        bucket: this.bucket,
        endpointHost: this.endpointHost,
        errorName: this.redact(typeof err.name === 'string' ? err.name : undefined),
        errorCode: this.redact(code === undefined || code === null ? undefined : String(code)),
        httpStatus: typeof httpStatus === 'number' ? httpStatus : undefined,
        errorMessage: this.redact(typeof err.message === 'string' ? err.message : String(error)),
      },
      FAILURE_MESSAGE,
    );
  }

  /** Replaces every configured key in the value; empty keys are never matched. */
  private redact(value: string | undefined): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    return this.secrets.reduce((result, secret) => result.split(secret).join(REDACTED), value);
  }
}
