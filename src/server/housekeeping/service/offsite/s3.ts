import { createHash } from 'crypto';
import * as fs from 'fs';
import { PassThrough, addAbortSignal } from 'stream';
import config from 'config';
import { PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import type { OffsiteDestination } from '@/server/housekeeping/service/offsite/destination';

/** Time allowed to open a connection to the store before the attempt fails. */
export const S3_CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Socket inactivity limit. It is an idle timer, so a slow upload that keeps
 * moving is unaffected; without it a store that accepts and never answers
 * leaves the upload pending forever.
 */
export const S3_SOCKET_TIMEOUT_MS = 60_000;

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
 *
 * Request checksums are pinned to WHEN_REQUIRED. The SDK default
 * (WHEN_SUPPORTED) sends the body aws-chunked with a trailing CRC32, which a
 * store that does not decode aws-chunked saves verbatim: a corrupt copy
 * reported as success. Integrity comes from Content-MD5 instead (see put).
 */
export function buildClientConfig(settings: OffsiteS3Settings): S3ClientConfig {
  const clientConfig: S3ClientConfig = {
    region: settings.region || 'us-east-1',
    forcePathStyle: Boolean(settings.endpoint),
    maxAttempts: 3,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    requestHandler: {
      connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
      socketTimeout: S3_SOCKET_TIMEOUT_MS,
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
 * Computes the base64 MD5 of a file in one streaming pass, never holding the
 * file in memory. Rejects with an AbortError when the signal aborts, and with
 * the read error when the file cannot be read; the async iterator turns a
 * stream 'error' event into that rejection, so nothing escapes as an
 * uncaughtException.
 */
async function md5Base64(localPath: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('md5');
  const stream = addAbortSignal(signal, fs.createReadStream(localPath));
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('base64');
}

/**
 * Off-host copy destination for AWS S3 and S3-compatible stores (MinIO,
 * Backblaze B2, DigitalOcean Spaces and others), selected by the `s3` driver.
 *
 * The upload is one PutObject of a file stream, carrying the file's MD5 as
 * Content-MD5, computed in a pass over the file before the upload. The store
 * checks the bytes it received against it and refuses a mismatch with
 * BadDigest, so a copy altered in transit is never kept. There is no read-back
 * (HeadObject or GetObject) to verify the stored object: the documented
 * write-only key policy withholds s3:GetObject, and must not be widened for it.
 *
 * The client is configured with
 * three attempts, but the SDK does not retry a streaming body, so in practice a
 * failed upload is not retried; the next backup makes a fresh copy.
 *
 * Only PutObject is ever sent (see OffsiteDestination on why a destination is
 * write-only).
 */
export default class S3Destination implements OffsiteDestination {
  readonly configError: string | null;
  readonly logFields: Readonly<Record<string, string>>;
  readonly secrets: readonly string[];

  private readonly bucket: string;
  private readonly client: S3Client | null;

  private constructor(settings: OffsiteS3Settings, client: S3Client | undefined) {
    this.configError = validateSettings(settings);
    this.bucket = settings.bucket;
    this.logFields = {
      bucket: settings.bucket,
      endpointHost: endpointHostOf(settings.endpoint),
      credentialSource: settings.accessKeyId && settings.secretAccessKey
        ? 'static keys'
        : 'default credential chain',
    };
    this.secrets = [settings.accessKeyId, settings.secretAccessKey].filter((value) => value.length > 0);
    this.client = this.configError
      ? null
      : client ?? new S3Client(buildClientConfig(settings));
  }

  /**
   * Builds the destination from `housekeeping.backup.offsite.s3`, or returns
   * null when no bucket is configured, which is what keeps the copy off. An
   * invalid configuration does not throw: the instance carries a
   * `configError` and builds no client.
   *
   * @param client - Injected S3 client, for tests
   */
  static fromConfig(client?: S3Client): S3Destination | null {
    const settings = readSettings();
    if (!settings.bucket) {
      return null;
    }
    return new S3Destination(settings, client);
  }

  async put(localPath: string, name: string, signal: AbortSignal): Promise<void> {
    if (!this.client) {
      throw Object.assign(new Error(this.configError ?? 'No S3 client'), { name: 'OffsiteConfigError' });
    }

    const { size } = await fs.promises.stat(localPath);
    const contentMD5 = await md5Base64(localPath, signal);

    // A read error on the file stream is an 'error' event, which a try does
    // not catch and which the SDK re-raises on its own wrapper stream. Piping
    // into a PassThrough keeps the error on the source, where it aborts the
    // request and settles the race below instead of escaping as an
    // uncaughtException.
    const source = fs.createReadStream(localPath);
    const body = source.pipe(new PassThrough());
    const readAbort = new AbortController();
    const readFailed = new Promise<never>((_, reject) => {
      source.on('error', (error) => {
        readAbort.abort();
        reject(error);
      });
    });
    // Mark the rejection handled for the paths that never reach the race
    // (send throwing synchronously) or settle it first (a read error after
    // the stream is destroyed); the race still sees it.
    readFailed.catch(() => {});

    try {
      await Promise.race([
        this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: name,
            Body: body,
            ContentLength: size,
            ContentMD5: contentMD5,
          }),
          { abortSignal: AbortSignal.any([signal, readAbort.signal]) },
        ),
        readFailed,
      ]);
    }
    finally {
      source.destroy();
      body.destroy();
    }
  }
}
