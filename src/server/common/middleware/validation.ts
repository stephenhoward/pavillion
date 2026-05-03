import { Request, Response, NextFunction } from 'express';
import { DateTime } from 'luxon';
import { ValidationError } from '@/common/exceptions/base';
import expressHelper from '@/server/common/helper/express';

/**
 * Middleware factory that validates a named route parameter is a valid UUID v4.
 *
 * Calls next() with a ValidationError if the parameter is missing or malformed,
 * which is handled by the global error handler and results in a 400 response.
 *
 * @param paramName - Name of the route parameter to validate (e.g. 'eventId')
 * @returns Express middleware function
 *
 * @example
 * router.get('/reports/:reportId',
 *   validateUUID('reportId'),
 *   async (req, res) => { ... }
 * );
 */
export function validateUUID(paramName: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const value = req.params[paramName];

    if (!value || !expressHelper.isValidUUID(value)) {
      return next(new ValidationError(`Invalid UUID for parameter '${paramName}'`));
    }

    next();
  };
}

/**
 * Middleware factory that validates required fields are present in the request
 * body or query string.
 *
 * Each field name in the array is checked against both req.body and req.query.
 * Calls next() with a ValidationError listing all missing fields.
 *
 * @param fields - Array of field names that must be present
 * @returns Express middleware function
 *
 * @example
 * router.post('/events',
 *   validateRequired(['title', 'startDate']),
 *   async (req, res) => { ... }
 * );
 */
export function validateRequired(fields: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const missing: string[] = [];

    for (const field of fields) {
      const inBody = req.body !== undefined && req.body !== null && req.body[field] !== undefined && req.body[field] !== null && req.body[field] !== '';
      const inQuery = req.query[field] !== undefined && req.query[field] !== null && req.query[field] !== '';

      if (!inBody && !inQuery) {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      const fieldErrors: Record<string, string[]> = {};
      for (const field of missing) {
        fieldErrors[field] = ['This field is required'];
      }
      return next(new ValidationError(
        `Missing required fields: ${missing.join(', ')}`,
        fieldErrors,
      ));
    }

    next();
  };
}

/**
 * Middleware that validates startDate and endDate query parameters.
 *
 * Both parameters are optional, but when provided they must be valid ISO 8601
 * date strings. When both are provided, startDate must not be after endDate.
 *
 * Calls next() with a ValidationError describing the problem.
 *
 * @returns Express middleware function
 *
 * @example
 * router.get('/events',
 *   validateDateRange(),
 *   async (req, res) => { ... }
 * );
 */
export function validateDateRange() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { startDate, endDate } = req.query;
    const errors: string[] = [];

    let start: DateTime | null = null;
    let end: DateTime | null = null;

    if (startDate !== undefined) {
      if (typeof startDate !== 'string') {
        errors.push("'startDate' must be a string");
      }
      else {
        start = DateTime.fromISO(startDate);
        if (!start.isValid) {
          errors.push("'startDate' is not a valid ISO 8601 date");
        }
      }
    }

    if (endDate !== undefined) {
      if (typeof endDate !== 'string') {
        errors.push("'endDate' must be a string");
      }
      else {
        end = DateTime.fromISO(endDate);
        if (!end.isValid) {
          errors.push("'endDate' is not a valid ISO 8601 date");
        }
      }
    }

    if (errors.length === 0 && start !== null && end !== null && start > end) {
      errors.push("'startDate' must not be after 'endDate'");
    }

    if (errors.length > 0) {
      return next(new ValidationError(errors));
    }

    next();
  };
}
