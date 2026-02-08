/**
 * Thrown when a user attempts to file a duplicate report for the same event.
 */
export class DuplicateReportError extends Error {
  constructor(message: string = 'A report has already been submitted for this event') {
    super(message);
    this.name = 'DuplicateReportError';
    Object.setPrototypeOf(this, DuplicateReportError.prototype);
  }
}

/**
 * Thrown when the report submission rate limit has been exceeded.
 */
export class RateLimitError extends Error {
  constructor(message: string = 'Too many reports submitted. Please try again later') {
    super(message);
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

/**
 * Thrown when report submission fails due to invalid input data.
 */
export class ReportValidationError extends Error {
  constructor(message: string = 'Invalid report data') {
    super(message);
    this.name = 'ReportValidationError';
    Object.setPrototypeOf(this, ReportValidationError.prototype);
  }
}
