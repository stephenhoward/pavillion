/**
 * Custom error class raised when a backup file cannot be created.
 * Carries the intended backup filename and the original underlying cause
 * (if any) so that worker-side retry/alert handlers can extract structured
 * context via `instanceof BackupCreateError` without resorting to string
 * parsing or `as any` casts.
 */
export class BackupCreateError extends Error {
  public readonly filename: string;
  public readonly cause: unknown;

  constructor(message: string, filename: string, cause?: unknown) {
    super(message);
    this.name = 'BackupCreateError';
    this.filename = filename;
    this.cause = cause;
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, BackupCreateError.prototype);
  }
}
