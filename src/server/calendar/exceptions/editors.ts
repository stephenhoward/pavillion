/**
 * Custom error class for when a user doesn't have permission to manage calendar editors
 */
export class CalendarEditorPermissionError extends Error {
  constructor(message: string = 'Permission denied: only calendar owner can manage editors') {
    super(message);
    this.name = 'CalendarEditorPermissionError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, CalendarEditorPermissionError.prototype);
  }
}

/**
 * Custom error class for when trying to grant edit access that already exists
 */
export class EditorAlreadyExistsError extends Error {
  constructor(message: string = 'Editor relationship already exists') {
    super(message);
    this.name = 'EditorAlreadyExistsError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, EditorAlreadyExistsError.prototype);
  }
}

/**
 * Custom error class for when trying to revoke edit access that doesn't exist
 */
export class EditorNotFoundError extends Error {
  constructor(message: string = 'Editor relationship not found') {
    super(message);
    this.name = 'EditorNotFoundError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, EditorNotFoundError.prototype);
  }
}
