import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarInterface from '../../interface';
import { CalendarEditorPermissionError, EditorAlreadyExistsError, EditorNotFoundError } from '@/common/exceptions/editor';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { noAccountExistsError } from '@/server/accounts/exceptions';

class EditorRoutes {
  private service: CalendarInterface;

  constructor(internalAPI: CalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    // Editor management routes
    router.get('/calendars/:calendarId/editors', ExpressHelper.loggedInOnly, this.listEditors.bind(this));
    router.post('/calendars/:calendarId/editors', ExpressHelper.loggedInOnly, this.grantEditAccess.bind(this));
    router.delete('/calendars/:calendarId/editors/:editorId', ExpressHelper.loggedInOnly, this.revokeEditAccess.bind(this));

    app.use(routePrefix, router);
  }

  /**
   * List all editors for a calendar
   * GET /api/v1/calendars/:calendarId/editors
   */
  async listEditors(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(401).json({
        "error": "Authentication required",
      });
      return;
    }

    try {
      // Check if user can view editors (only calendar owners and admins)
      const canView = await this.service.canViewCalendarEditors(account, req.params.calendarId);
      if (!canView) {
        res.status(403).json({
          "error": "Permission denied: only calendar owner can view editors",
        });
        return;
      }

      const editors = await this.service.getCalendarEditors(req.params.calendarId);
      res.json(editors.map((editor) => editor.toObject()));
    }
    catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({
          "error": error.message,
        });
      }
      else {
        console.error("Error listing calendar editors:", error);
        res.status(500).json({
          "error": "An error occurred while listing calendar editors",
        });
      }
    }
  }

  /**
   * Grant edit access to a user for a calendar
   * POST /api/v1/calendars/:calendarId/editors
   * Body: { accountId: string } OR { email: string }
   */
  async grantEditAccess(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(401).json({
        "error": "Authentication required",
      });
      return;
    }

    // Accept either accountId or email, and optional message
    const { email, message } = req.body;

    if (!email) {
      res.status(400).json({
        "error": "Missing email in request body",
      });
      return;
    }

    try {
      // New behavior - grant access by email (handles both existing and new users)
      const result = await this.service.grantEditAccessByEmail(account, req.params.calendarId, email, message);
      res.status(201).json(result);
    }
    catch (error) {
      if (error instanceof CalendarEditorPermissionError) {
        res.status(403).json({
          "error": error.message,
        });
      }
      else if (error instanceof EditorAlreadyExistsError) {
        res.status(409).json({
          "error": error.message,
        });
      }
      else if (error instanceof CalendarNotFoundError || error instanceof noAccountExistsError) {
        res.status(404).json({
          "error": error.message,
        });
      }
      else {
        console.error("Error granting edit access:", error);
        res.status(500).json({
          "error": "An error occurred while granting edit access",
        });
      }
    }
  }

  /**
   * Revoke edit access from a user for a calendar
   * DELETE /api/v1/calendars/:calendarId/editors/:accountId
   */
  async revokeEditAccess(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(401).json({
        "error": "Authentication required",
      });
      return;
    }

    try {
      await this.service.revokeEditAccess(account, req.params.calendarId, req.params.accountId);
      res.status(204).send();
    }
    catch (error) {
      if (error instanceof CalendarEditorPermissionError) {
        res.status(403).json({
          "error": error.message,
        });
      }
      else if (error instanceof EditorNotFoundError) {
        res.status(404).json({
          "error": error.message,
        });
      }
      else if (error instanceof CalendarNotFoundError || error instanceof noAccountExistsError) {
        res.status(404).json({
          "error": error.message,
        });
      }
      else {
        console.error("Error revoking edit access:", error);
        res.status(500).json({
          "error": "An error occurred while revoking edit access",
        });
      }
    }
  }
}

export default EditorRoutes;
