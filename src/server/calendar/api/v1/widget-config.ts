import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import { SubscriptionRequiredError } from '@/common/exceptions/subscription';
import { widgetConfigByAccount } from '@/server/common/middleware/rate-limiters';
import CalendarInterface from '../../interface';

/**
 * API routes for widget configuration and domain management.
 * Allows calendar owners/editors to configure widget settings and manage the allowed domain.
 */
class WidgetConfigRoutes {
  private service: CalendarInterface;

  constructor(internalAPI: CalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/calendars/:calendarId/widget/domain', ExpressHelper.loggedInOnly, widgetConfigByAccount, this.getDomain.bind(this));
    router.put('/calendars/:calendarId/widget/domain', ExpressHelper.loggedInOnly, widgetConfigByAccount, this.setDomain.bind(this));
    router.delete('/calendars/:calendarId/widget/domain', ExpressHelper.loggedInOnly, widgetConfigByAccount, this.clearDomain.bind(this));
    app.use(routePrefix, router);
  }

  /**
   * Get the allowed domain for a calendar's widget.
   */
  async getDomain(req: Request, res: Response) {
    const account = req.user as Account;
    const { calendarId } = req.params;

    if (!account) {
      res.status(400).json({
        "error": "missing account. Not logged in?",
        errorName: 'AuthenticationError',
      });
      return;
    }

    if (!calendarId) {
      res.status(400).json({
        "error": "missing calendarId",
        errorName: 'ValidationError',
      });
      return;
    }

    // Validate UUID format
    if (!ExpressHelper.isValidUUID(calendarId)) {
      res.status(400).json({
        "error": "invalid calendarId format",
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      const domain = await this.service.getWidgetDomain(account, calendarId);

      res.json({
        domain: domain,
      });
    }
    catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({
          "error": "Calendar not found",
          "errorName": error.name,
        });
      }
      else if (error instanceof CalendarEditorPermissionError) {
        res.status(403).json({
          "error": "Permission denied",
          "errorName": error.name,
        });
      }
      else {
        console.error("Error getting widget domain:", error);
        res.status(500).json({
          "error": "An error occurred while getting widget domain",
        });
      }
    }
  }

  /**
   * Set the allowed domain for a calendar's widget.
   */
  async setDomain(req: Request, res: Response) {
    const account = req.user as Account;
    const { calendarId } = req.params;
    const { domain } = req.body;

    if (!account) {
      res.status(400).json({
        "error": "missing account. Not logged in?",
        errorName: 'AuthenticationError',
      });
      return;
    }

    if (!calendarId) {
      res.status(400).json({
        "error": "missing calendarId",
        errorName: 'ValidationError',
      });
      return;
    }

    // Validate UUID format
    if (!ExpressHelper.isValidUUID(calendarId)) {
      res.status(400).json({
        "error": "invalid calendarId format",
        errorName: 'ValidationError',
      });
      return;
    }

    if (!domain || typeof domain !== 'string') {
      res.status(400).json({
        "error": "missing or invalid domain",
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      await this.service.setWidgetDomain(account, calendarId, domain);

      res.json({
        domain: domain,
      });
    }
    catch (error) {
      if (error instanceof SubscriptionRequiredError) {
        res.status(402).json({
          "error": "subscription_required",
          "errorName": error.name,
          "message": error.message,
          "feature": error.feature,
        });
      }
      else if (error instanceof CalendarNotFoundError) {
        res.status(404).json({
          "error": "Calendar not found",
          "errorName": error.name,
        });
      }
      else if (error instanceof CalendarEditorPermissionError) {
        res.status(403).json({
          "error": "Permission denied",
          "errorName": error.name,
        });
      }
      else if (error instanceof Error && error.message.includes('Invalid domain format')) {
        res.status(400).json({
          "error": error.message,
          "errorName": "InvalidDomainFormatError",
        });
      }
      else {
        console.error("Error setting widget domain:", error);
        res.status(500).json({
          "error": "An error occurred while setting widget domain",
        });
      }
    }
  }

  /**
   * Clear the allowed domain for a calendar's widget.
   */
  async clearDomain(req: Request, res: Response) {
    const account = req.user as Account;
    const { calendarId } = req.params;

    if (!account) {
      res.status(400).json({
        "error": "missing account. Not logged in?",
        errorName: 'AuthenticationError',
      });
      return;
    }

    if (!calendarId) {
      res.status(400).json({
        "error": "missing calendarId",
        errorName: 'ValidationError',
      });
      return;
    }

    // Validate UUID format
    if (!ExpressHelper.isValidUUID(calendarId)) {
      res.status(400).json({
        "error": "invalid calendarId format",
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      await this.service.clearWidgetDomain(account, calendarId);

      res.json({ success: true });
    }
    catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({
          "error": "Calendar not found",
          "errorName": error.name,
        });
      }
      else if (error instanceof CalendarEditorPermissionError) {
        res.status(403).json({
          "error": "Permission denied",
          "errorName": error.name,
        });
      }
      else {
        console.error("Error clearing widget domain:", error);
        res.status(500).json({
          "error": "An error occurred while clearing widget domain",
        });
      }
    }
  }
}

export default WidgetConfigRoutes;
