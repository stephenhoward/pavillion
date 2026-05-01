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
  err: Error & { status?: number; statusCode?: number; type?: string },
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
): void {
  // Log the full error details server-side
  logError(err, `Unhandled error in ${req.method} ${req.path}`);

  // Honor 4xx status codes set by upstream middleware (body-parser produces
  // 413 for payload too large, 400 for malformed JSON, etc.). Anything 5xx
  // or unset collapses to a generic 500 to avoid leaking internals.
  const upstreamStatus = err.status ?? err.statusCode;
  const status = (typeof upstreamStatus === 'number' && upstreamStatus >= 400 && upstreamStatus < 500)
    ? upstreamStatus
    : 500;

  if (!res.headersSent) {
    res.status(status).json({
      error: status === 500 ? 'Internal server error' : (err.message || 'Request error'),
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
