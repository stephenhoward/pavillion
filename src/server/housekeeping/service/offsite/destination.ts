/**
 * A place an off-host copy of a backup can be written.
 *
 * Each destination type (S3-compatible storage today) implements this, and
 * OffsiteCopyService selects one from `housekeeping.backup.offsite.driver`.
 * The service owns the never-rejects contract, the failure log and redaction;
 * a destination only validates its own settings and writes the file.
 *
 * **Write-only by design.** There is no delete, list or overwrite-check
 * method, and none should be added: a host that can remove its own off-host
 * copies lets a compromise of that host, or a retention bug, destroy both
 * copies. Expiry of remote copies is the destination's own policy (for S3, a
 * bucket lifecycle rule), configured by the operator.
 */
export interface OffsiteDestination {
  /**
   * Why the settings cannot be used, or null when they can. Must never echo a
   * configured credential, so it is safe to log.
   */
  readonly configError: string | null;

  /**
   * Fields naming where copies go and how the destination authenticates (for
   * S3: bucket, endpoint host and credential source), added to every startup
   * and failure log line. Never a credential value.
   */
  readonly logFields: Readonly<Record<string, string>>;

  /** Configured secret values, redacted from any logged error text. */
  readonly secrets: readonly string[];

  /**
   * Writes the local file to the destination under `name`.
   *
   * Resolves only once the destination has accepted content it checked
   * against the local file (for S3, Content-MD5), since the caller reports a
   * resolved write as a stored copy. That check must not be a read-back of
   * the stored object, which a write-only destination cannot do.
   *
   * Rejects on any failure; the caller turns that into a logged `false`. Must
   * stop and reject promptly once `signal` aborts, and must not leave an
   * error to escape as an uncaught stream event.
   *
   * @param localPath - Full path of the dump on disk
   * @param name - Destination-relative name, e.g. `pavillion-backups/<file>`
   * @param signal - Aborted by the caller to abandon the write
   */
  put(localPath: string, name: string, signal: AbortSignal): Promise<void>;
}
