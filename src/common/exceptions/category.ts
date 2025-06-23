/**
 * Custom error class for category not found
 */
export class CategoryNotFoundError extends Error {
  constructor(message: string = 'Category not found') {
    super(message);
    this.name = 'CategoryNotFoundError';
    Object.setPrototypeOf(this, CategoryNotFoundError.prototype);
  }
}

/**
 * Custom error class for category assignment not found
 */
export class CategoryAssignmentNotFoundError extends Error {
  constructor(message: string = 'Category assignment not found') {
    super(message);
    this.name = 'CategoryAssignmentNotFoundError';
    Object.setPrototypeOf(this, CategoryAssignmentNotFoundError.prototype);
  }
}

/**
 * Custom error class for category already assigned to event
 */
export class CategoryAlreadyAssignedError extends Error {
  constructor(message: string = 'Category is already assigned to this event') {
    super(message);
    this.name = 'CategoryAlreadyAssignedError';
    Object.setPrototypeOf(this, CategoryAlreadyAssignedError.prototype);
  }
}

/**
 * Custom error class for category and event belonging to different calendars
 */
export class CategoryEventCalendarMismatchError extends Error {
  constructor(message: string = 'Event and category must belong to the same calendar') {
    super(message);
    this.name = 'CategoryEventCalendarMismatchError';
    Object.setPrototypeOf(this, CategoryEventCalendarMismatchError.prototype);
  }
}

/**
 * Custom error class for failed category update operations
 */
export class CategoryUpdateFailedError extends Error {
  constructor(message: string = 'Failed to retrieve updated category') {
    super(message);
    this.name = 'CategoryUpdateFailedError';
    Object.setPrototypeOf(this, CategoryUpdateFailedError.prototype);
  }
}
