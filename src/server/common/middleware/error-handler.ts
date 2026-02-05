import { Request, Response, NextFunction } from 'express';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Global error handling middleware for Express.
 *
 * This middleware catches all unhandled errors that bubble up through the
 * application and ensures they are logged server-side while only sending
 * generic error messages to clients (never stack traces or internal details).
 *
 * IMPORTANT: This must be registered AFTER all other routes and middleware.
 */
export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
): void {
  // Log the full error details server-side
  logError(err, `Unhandled error in ${req.method} ${req.path}`);

  // Send generic error response to client (no stack traces or internal details)
  if (!res.headersSent) {
    res.status(500).json({
      error: "Internal server error",
    });
  }
}

/**
 * Async error wrapper for route handlers.
 *
 * Wraps async route handlers to catch any rejected promises and pass them
 * to the next error handler, preventing unhandled promise rejections.
 *
 * @param fn - The async route handler function
 * @returns Wrapped function that catches errors
 *
 * @example
 * router.get('/events', asyncErrorHandler(async (req, res) => {
 *   const events = await service.getEvents();
 *   res.json(events);
 * }));
 */
export function asyncErrorHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
