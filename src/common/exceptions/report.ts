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
 * Contains an array of validation error messages.
 *
 * Accepts either a string message (for frontend use when reconstructing
 * from API error responses) or a string array of individual validation
 * errors (for backend service-layer validation).
 */
export class ReportValidationError extends Error {
  public errors: string[];

  constructor(errors: string[] | string = 'Invalid report data') {
    const errorArray = typeof errors === 'string' ? [errors] : errors;
    super(errorArray.join('; ') || 'Invalid report data');
    this.name = 'ReportValidationError';
    this.errors = errorArray;
    Object.setPrototypeOf(this, ReportValidationError.prototype);
  }
}
