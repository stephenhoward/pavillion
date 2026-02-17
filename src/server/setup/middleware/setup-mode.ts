import { Request, Response, NextFunction } from 'express';
import SetupInterface from '@/server/setup/interface';

/**
 * Paths that should be exempt from setup mode blocking.
 * These paths are necessary for the setup process itself or for system health checks.
 */
const EXEMPT_PATHS = [
  '/setup',
  '/api/v1/setup',
  '/api/config',
  '/health',
  '/assets',
  '/widget', // Widget pages and API should be accessible for embedding
];

/**
 * Checks if a request path is exempt from setup mode blocking.
 *
 * @param path - The request path to check
 * @returns true if the path is exempt, false otherwise
 */
function isExemptPath(path: string): boolean {
  return EXEMPT_PATHS.some((exemptPath) => {
    // Exact match or path starts with exempt path followed by / or end
    return path === exemptPath || path.startsWith(`${exemptPath}/`);
  });
}

/**
 * Checks if a request appears to be from a browser expecting HTML.
 *
 * @param req - Express request object
 * @returns true if the request is likely from a browser, false otherwise
 */
function isBrowserRequest(req: Request): boolean {
  const acceptHeader = req.headers.accept || '';
  return acceptHeader.includes('text/html');
}

/**
 * Creates the setup mode middleware.
 *
 * This middleware enforces setup mode by:
 * - Redirecting browser requests to /setup when setup mode is active
 * - Returning 503 for API requests when setup mode is active
 * - Allowing exempt paths (/setup, /api/v1/setup/*, /health, /assets)
 * - Blocking /setup route (returning 404) when setup is complete
 *
 * @param setupInterface - The setup interface for checking setup mode status
 * @returns Express middleware function
 */
export function createSetupModeMiddleware(setupInterface: SetupInterface) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSetupMode = await setupInterface.isSetupModeActive();
      const path = req.path;

      if (isSetupMode) {
        // Setup mode is active - block most routes

        // Allow exempt paths
        if (isExemptPath(path)) {
          next();
          return;
        }

        // Block other routes
        if (isBrowserRequest(req)) {
          // Redirect browser requests to /setup
          res.redirect(302, '/setup');
          return;
        }
        else {
          // Return 503 for API requests
          res.status(503).json({ error: 'Setup required' });
          return;
        }
      }
      else {
        // Setup is complete - block /setup route only

        if (path === '/setup' || path.startsWith('/setup/')) {
          // Block /setup route when setup is complete
          res.status(404).json({ error: 'Not found' });
          return;
        }

        // Allow all other routes
        next();
        return;
      }
    }
    catch (error) {
      // If there's an error checking setup mode, log it and continue
      // This prevents the middleware from breaking the entire app
      console.error('Error in setup mode middleware:', error);
      next();
    }
  };
}
