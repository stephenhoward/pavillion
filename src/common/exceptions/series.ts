/**
 * Custom error class for series not found
 */
export class SeriesNotFoundError extends Error {
  constructor(message: string = 'Series not found') {
    super(message);
    this.name = 'SeriesNotFoundError';
    Object.setPrototypeOf(this, SeriesNotFoundError.prototype);
  }
}

/**
 * Custom error class for series URL name already in use within the same calendar
 */
export class SeriesUrlNameAlreadyExistsError extends Error {
  constructor(message: string = 'A series with this URL name already exists in this calendar') {
    super(message);
    this.name = 'SeriesUrlNameAlreadyExistsError';
    Object.setPrototypeOf(this, SeriesUrlNameAlreadyExistsError.prototype);
  }
}

/**
 * Custom error class for invalid series URL name format
 */
export class InvalidSeriesUrlNameError extends Error {
  constructor(message: string = 'Invalid series URL name') {
    super(message);
    this.name = 'InvalidSeriesUrlNameError';
    Object.setPrototypeOf(this, InvalidSeriesUrlNameError.prototype);
  }
}

/**
 * Custom error class for series and event belonging to different calendars
 */
export class SeriesEventCalendarMismatchError extends Error {
  constructor(message: string = 'Event and series must belong to the same calendar') {
    super(message);
    this.name = 'SeriesEventCalendarMismatchError';
    Object.setPrototypeOf(this, SeriesEventCalendarMismatchError.prototype);
  }
}

/**
 * Custom error class for duplicate series name within the same calendar and language
 */
export class DuplicateSeriesNameError extends Error {
  constructor(message: string = 'A series with this name already exists in this calendar') {
    super(message);
    this.name = 'DuplicateSeriesNameError';
    Object.setPrototypeOf(this, DuplicateSeriesNameError.prototype);
  }
}
