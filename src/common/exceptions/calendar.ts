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
 * Custom error class for invalid external URL on an event
 */
export class InvalidExternalUrlError extends Error {
  constructor(message: string = 'invalid external url') {
    super(message);
    this.name = 'InvalidExternalUrlError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, InvalidExternalUrlError.prototype);
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

/**
 * Custom error class for events not found during bulk operations
 */
export class BulkEventsNotFoundError extends Error {
  constructor(message: string = 'Some events were not found or you do not have permission to modify them') {
    super(message);
    this.name = 'BulkEventsNotFoundError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, BulkEventsNotFoundError.prototype);
  }
}

/**
 * Custom error class for events belonging to different calendars during bulk operations
 */
export class MixedCalendarEventsError extends Error {
  constructor(message: string = 'All events must belong to the same calendar') {
    super(message);
    this.name = 'MixedCalendarEventsError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, MixedCalendarEventsError.prototype);
  }
}

/**
 * Custom error class for categories not found in calendar during bulk operations
 */
export class CategoriesNotFoundError extends Error {
  constructor(message: string = 'Some categories were not found in the calendar') {
    super(message);
    this.name = 'CategoriesNotFoundError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, CategoriesNotFoundError.prototype);
  }
}

/**
 * Custom error class for location (Place) or Space not found
 */
export class LocationNotFoundError extends Error {
  constructor(message: string = 'Location not found') {
    super(message);
    this.name = 'LocationNotFoundError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, LocationNotFoundError.prototype);
  }
}

/**
 * Custom error class for invalid location data
 * Contains an array of validation error messages
 */
export class LocationValidationError extends Error {
  public errors: string[];

  constructor(errors: string[]) {
    super(errors.join('; '));
    this.name = 'LocationValidationError';
    this.errors = errors;
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, LocationValidationError.prototype);
  }
}

/**
 * Custom error class for invalid domain format in widget configuration
 */
export class InvalidDomainFormatError extends Error {
  constructor(message: string = 'Domain must not include protocol or path.') {
    super(message);
    this.name = 'InvalidDomainFormatError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, InvalidDomainFormatError.prototype);
  }
}

/**
 * Custom error class raised when a supplied occurrence start date does not
 * match any expansion of the event's RRuleSet. Serialized as HTTP 422 at the
 * API boundary, with a body containing only `{ errorName }` — the human
 * message is intentionally not echoed to the client for privacy/consistency.
 */
export class InvalidOccurrenceDateError extends Error {
  constructor(message: string = 'Supplied date does not match any occurrence of this event') {
    super(message);
    this.name = 'InvalidOccurrenceDateError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, InvalidOccurrenceDateError.prototype);
  }
}

/**
 * Custom error class raised when an event's selected Space does not belong to
 * the event's selected Place. Enforces the Space/Place invariant at the
 * service layer.
 */
export class SpaceLocationMismatchError extends Error {
  constructor(
    public spaceId: string,
    public expectedPlaceId: string,
    public actualPlaceId: string,
    message?: string,
  ) {
    super(message ?? `Space ${spaceId} belongs to place ${actualPlaceId}, not ${expectedPlaceId}`);
    this.name = 'SpaceLocationMismatchError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, SpaceLocationMismatchError.prototype);
  }
}

/**
 * Custom error class raised when an incoming Space `id` in a Place update
 * snapshot does not match a row scoped by `place_id = :locationId`.
 *
 * This is the security boundary for nested Place + Spaces save:
 * the caller cannot smuggle a Space `id` from a sibling Place — even one
 * owned by the same calendar — into another Place's update payload. The
 * service-layer diff rejects any incoming Space `id` not present in the
 * loaded set scoped to the route's `:locationId`. Serialized as HTTP 400
 * at the API boundary with `errorName: 'SpaceHijackError'`.
 */
export class SpaceHijackError extends Error {
  constructor(
    public spaceId: string,
    public expectedPlaceId: string,
    message?: string,
  ) {
    super(message ?? `Space ${spaceId} does not belong to place ${expectedPlaceId}`);
    this.name = 'SpaceHijackError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, SpaceHijackError.prototype);
  }
}

/**
 * Custom error class raised when an incoming Space `clientId` in a Place
 * create/update snapshot is not a valid UUID v4. Serialized as HTTP 400 at
 * the API boundary with `errorName: 'InvalidClientIdError'`.
 *
 * `clientId` is a transient correlation token and never a row primary key,
 * but it must still be a well-formed UUID so the round-trip echo cannot be
 * abused to inject arbitrary data into the response payload.
 */
export class InvalidClientIdError extends Error {
  constructor(
    public clientId: unknown,
    message?: string,
  ) {
    super(message ?? 'Invalid clientId format');
    this.name = 'InvalidClientIdError';
    // Maintaining proper prototype chain in ES5+
    Object.setPrototypeOf(this, InvalidClientIdError.prototype);
  }
}
