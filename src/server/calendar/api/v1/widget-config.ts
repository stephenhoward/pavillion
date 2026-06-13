import express, { Request, Response, Application } from 'express';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('calendar');

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarNotFoundError, InvalidDomainFormatError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import { SubscriptionRequiredError } from '@/common/exceptions/subscription';
import { limitWidgetConfigByAccount } from '@/server/common/middleware/rate-limiters';
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
    router.get('/calendars/:calendarId/widget/domain', ExpressHelper.loggedInOnly, limitWidgetConfigByAccount, this.getDomain.bind(this));
    router.put('/calendars/:calendarId/widget/domain', ExpressHelper.loggedInOnly, limitWidgetConfigByAccount, this.setDomain.bind(this));
    router.delete('/calendars/:calendarId/widget/domain', ExpressHelper.loggedInOnly, limitWidgetConfigByAccount, this.clearDomain.bind(this));
    router.get('/calendars/:calendarId/widget/config', ExpressHelper.loggedInOnly, limitWidgetConfigByAccount, this.getConfig.bind(this));
    router.put('/calendars/:calendarId/widget/config', ExpressHelper.loggedInOnly, limitWidgetConfigByAccount, this.setConfig.bind(this));
    app.use(routePrefix, router);
  }

  /**
   * Get the allowed domain for a calendar's widget.
   */
  async getDomain(req: Request, res: Response) {
    const account = req.user as Account;
    const { calendarId } = req.params;

    if (!account) {
      res.status(401).json({
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
        logger.error({ err: error }, 'Error getting widget domain');
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
      res.status(401).json({
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
      else if (error instanceof InvalidDomainFormatError) {
        res.status(400).json({
          "error": "Invalid domain format",
          "errorName": error.name,
        });
      }
      else {
        logger.error({ err: error }, 'Error setting widget domain');
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
      res.status(401).json({
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
        logger.error({ err: error }, 'Error clearing widget domain');
        res.status(500).json({
          "error": "An error occurred while clearing widget domain",
        });
      }
    }
  }

  /**
   * Get the widget display configuration (view / accentColor / colorMode) for a calendar.
   * Returns a fresh defaults object when no row exists, so the admin form always has
   * something to populate from.
   */
  async getConfig(req: Request, res: Response) {
    const account = req.user as Account;
    const { calendarId } = req.params;

    if (!account) {
      res.status(401).json({
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

    if (!ExpressHelper.isValidUUID(calendarId)) {
      res.status(400).json({
        "error": "invalid calendarId format",
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      const config = await this.service.getWidgetConfigForEditor(account, calendarId);
      res.json(config.toObject());
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
        logger.error({ err: error }, 'Error getting widget config');
        res.status(500).json({
          "error": "An error occurred while getting widget config",
        });
      }
    }
  }

  /**
   * Upsert the widget display configuration for a calendar.
   * Request body: { view, accentColor, colorMode }. All fields validated in the service;
   * invalid fields surface as a ValidationError with camelCase field keys.
   */
  async setConfig(req: Request, res: Response) {
    const account = req.user as Account;
    const { calendarId } = req.params;

    if (!account) {
      res.status(401).json({
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

    if (!ExpressHelper.isValidUUID(calendarId)) {
      res.status(400).json({
        "error": "invalid calendarId format",
        errorName: 'ValidationError',
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const configInput = {
      view: body.view as any,
      accentColor: body.accentColor as any,
      colorMode: body.colorMode as any,
    };

    try {
      const saved = await this.service.setWidgetConfig(account, calendarId, configInput);
      res.json(saved.toObject());
    }
    catch (error) {
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
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
      else {
        logger.error({ err: error }, 'Error setting widget config');
        res.status(500).json({
          "error": "An error occurred while setting widget config",
        });
      }
    }
  }
}

export default WidgetConfigRoutes;
