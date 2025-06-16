/**
 * Custom error class for invalid calendar URL name format
 */
export class InvalidUrlNameError extends Error {
  constructor(message: string = 'Invalid Calendar URL name format') {
    super(message);
    this.name = 'InvalidUrlNameError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, InvalidUrlNameError.prototype);
  }
}

/**
 * Custom error class for calendar URL name that already exists
 */
export class UrlNameAlreadyExistsError extends Error {
  constructor(message: string = 'Calendar URL name already exists') {
    super(message);
    this.name = 'UrlNameAlreadyExistsError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, UrlNameAlreadyExistsError.prototype);
  }
}

/**
 * Custom error class for calendar not found
 */
export class CalendarNotFoundError extends Error {
  constructor(message: string = 'Calendar not found') {
    super(message);
    this.name = 'CalendarNotFoundError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, CalendarNotFoundError.prototype);
  }
}

/**
 * Custom error class for event not found
 */
export class EventNotFoundError extends Error {
  constructor(message: string = 'Event not found') {
    super(message);
    this.name = 'EventNotFoundError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, EventNotFoundError.prototype);
  }
}

/**
 * Custom error class for insufficient permissions to modify calendar/events
 */
export class InsufficientCalendarPermissionsError extends Error {
  constructor(message: string = 'Insufficient permissions to modify this calendar') {
    super(message);
    this.name = 'InsufficientCalendarPermissionsError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, InsufficientCalendarPermissionsError.prototype);
  }
}
