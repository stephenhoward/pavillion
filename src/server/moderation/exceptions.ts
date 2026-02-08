/**
 * Custom error class for invalid or expired verification tokens.
 * Thrown when an anonymous reporter attempts to verify with a bad token.
 */
export class InvalidVerificationTokenError extends Error {
  constructor(message: string = 'Verification token is invalid or has expired') {
    super(message);
    this.name = 'InvalidVerificationTokenError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, InvalidVerificationTokenError.prototype);
  }
}

/**
 * Custom error class for report not found.
 * Thrown when a report ID does not match any existing report.
 */
export class ReportNotFoundError extends Error {
  constructor(message: string = 'Report not found') {
    super(message);
    this.name = 'ReportNotFoundError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, ReportNotFoundError.prototype);
  }
}

/**
 * Custom error class for attempting to act on a resolved report.
 * Thrown when a moderation action targets a report that has already been closed.
 */
export class ReportAlreadyResolvedError extends Error {
  constructor(message: string = 'Report has already been resolved') {
    super(message);
    this.name = 'ReportAlreadyResolvedError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, ReportAlreadyResolvedError.prototype);
  }
}

/**
 * Custom error class for per-email rate limit exceeded.
 * Thrown when an email address has exceeded the maximum number of
 * verification emails within the configured time window.
 */
export class EmailRateLimitError extends Error {
  constructor(message: string = 'Too many reports from this email address, please try again later') {
    super(message);
    this.name = 'EmailRateLimitError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, EmailRateLimitError.prototype);
  }
}
