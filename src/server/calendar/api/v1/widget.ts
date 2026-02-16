import express, { Request, Response, Application, NextFunction } from 'express';

import CalendarInterface from '../../interface';
import WidgetDomainService from '../../service/widget_domain';
import { SubscriptionRequiredError } from '@/common/exceptions/subscription';
import { publicWidgetByIp } from '@/server/common/middleware/rate-limiters';

/**
 * Widget-specific API routes with Origin validation and dynamic CSP headers.
 * These routes enable secure embedding of calendar widgets on authorized external domains.
 */
class WidgetRoutes {
  private service: CalendarInterface;
  private widgetDomainService: WidgetDomainService;

  constructor(internalAPI: CalendarInterface, widgetDomainService?: WidgetDomainService) {
    this.service = internalAPI;
    this.widgetDomainService = widgetDomainService || new WidgetDomainService();
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    // Apply Origin validation middleware to all widget routes
    router.use(this.validateOrigin.bind(this));

    // Widget calendar metadata endpoint with rate limiting
    router.get('/calendars/:urlName', publicWidgetByIp, this.getCalendar.bind(this));

    app.use(routePrefix, router);
  }

  /**
   * Origin validation middleware.
   * Validates that the requesting domain is authorized to embed the widget.
   * Automatically allows localhost for development testing.
   *
   * Sets dynamic CSP frame-ancestors header and CORS headers for valid origins.
   */
  private async validateOrigin(req: Request, res: Response, next: NextFunction) {
    const origin = req.get('Origin');

    // Require Origin header for all widget requests
    if (!origin) {
      res.status(403).json({
        "error": "Origin header is required for widget requests",
        errorName: 'ForbiddenError',
      });
      return;
    }

    // Extract calendar name from URL path
    // Pattern: /calendars/:urlName or /calendars/:urlName/...
    const urlNameMatch = req.path.match(/^\/calendars\/([^/]+)/);
    if (!urlNameMatch) {
      // If no calendar in path, skip validation (will fail at route handler)
      next();
      return;
    }

    const calendarUrlName = urlNameMatch[1];

    try {
      // Get calendar to check authorization
      const calendar = await this.service.getCalendarByName(calendarUrlName);
      if (!calendar) {
        // Calendar not found - let route handler deal with 404
        next();
        return;
      }

      // Check if origin is allowed (includes localhost exception)
      const isAllowed = await this.widgetDomainService.isOriginAllowed(calendar, origin);

      if (!isAllowed) {
        res.status(403).json({
          "error": `Domain '${origin}' is not authorized to embed this calendar widget. Please add your domain to the widget allowlist in calendar settings.`,
          errorName: 'ForbiddenError',
        });
        return;
      }

      // Origin is allowed - set security headers
      // Override helmet's frame-ancestors CSP with validated origin
      // Dynamic CSP frame-ancestors header with specific requesting domain
      res.setHeader('Content-Security-Policy', `frame-ancestors ${origin}`);

      // Add X-Frame-Options for legacy browser support (IE11+)
      // Note: Modern browsers prefer CSP frame-ancestors, but this provides defense-in-depth
      res.setHeader('X-Frame-Options', `ALLOW-FROM ${origin}`);

      // CORS headers for validated domain
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'false');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type');

      next();
    }
    catch (error) {
      console.error('Error in Origin validation:', error);
      res.status(500).json({
        "error": "Failed to validate Origin",
      });
    }
  }

  /**
   * Get calendar metadata for widget display.
   * Returns basic calendar information needed to render the widget.
   *
   * @route GET /api/widget/v1/calendars/:urlName
   */
  async getCalendar(req: Request, res: Response) {
    const calendarUrlName = req.params.urlName;

    try {
      // Use getCalendarForWidget which includes subscription check
      const calendar = await this.service.getCalendarForWidget(calendarUrlName);

      if (!calendar) {
        res.status(404).json({
          "error": "Calendar not found",
          errorName: 'CalendarNotFoundError',
        });
        return;
      }

      // Return calendar data
      res.json(calendar.toObject());
    }
    catch (error: any) {
      if (error instanceof SubscriptionRequiredError) {
        // Return 402 with Cache-Control: no-store header
        res.set('Cache-Control', 'no-store');
        res.status(402).json({
          error: 'subscription_required',
          errorName: error.name,
          message: error.message,
          feature: error.feature,
        });
        return;
      }

      console.error('Error fetching calendar for widget:', error);
      res.status(500).json({
        "error": "Failed to fetch calendar",
        "details": error.message,
      });
    }
  }
}

export default WidgetRoutes;
