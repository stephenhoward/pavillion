import type { Request, Response, NextFunction } from 'express';
import { stripLocalePrefix } from '@/common/i18n/locale-url';

// Augment Express Request to carry the resolved locale for the current request.
declare global {
  namespace Express {
    interface Request {
      locale?: string;
    }
  }
}

/**
 * Express middleware that resolves the active locale for each request.
 *
 * Detection chain: URL prefix (e.g. /es/@calendar) → unset (callers fall back
 * to their own default via `req.locale ?? DEFAULT_LANGUAGE_CODE`).
 *
 * Sets `req.locale` when a valid language prefix is found in the URL path.
 * Route handlers that need a locale should read `req.locale ?? DEFAULT_LANGUAGE_CODE`.
 */
export function localeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const { locale } = stripLocalePrefix(req.path);

  if (locale) {
    req.locale = locale;
  }

  next();
}
