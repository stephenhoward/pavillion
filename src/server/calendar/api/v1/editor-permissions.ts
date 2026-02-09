import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarInterface from '../../interface';
import { CalendarEditorPermissionError, EditorNotFoundError } from '@/common/exceptions/editor';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';

class EditorPermissionRoutes {
  private service: CalendarInterface;

  constructor(internalAPI: CalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    router.put(
      '/calendars/:calendarId/editors/:editorId/permissions',
      ExpressHelper.loggedInOnly,
      this.updatePermissions.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * Update permissions for an editor on a calendar.
   * PUT /api/v1/calendars/:calendarId/editors/:editorId/permissions
   * Body: { canReviewReports: boolean }
   */
  async updatePermissions(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(401).json({
        "error": "Authentication required",
      });
      return;
    }

    const { canReviewReports } = req.body;

    if (typeof canReviewReports !== 'boolean') {
      res.status(400).json({
        "error": "Missing or invalid 'canReviewReports' in request body. Must be a boolean.",
      });
      return;
    }

    try {
      const updatedMember = await this.service.updateEditorPermissions(
        account,
        req.params.calendarId,
        req.params.editorId,
        { canReviewReports },
      );

      res.json(updatedMember.toObject());
    }
    catch (error) {
      if (error instanceof CalendarEditorPermissionError) {
        res.status(403).json({
          "error": error.message,
        });
      }
      else if (error instanceof CalendarNotFoundError) {
        res.status(404).json({
          "error": error.message,
        });
      }
      else if (error instanceof EditorNotFoundError) {
        res.status(404).json({
          "error": error.message,
        });
      }
      else {
        console.error("Error updating editor permissions:", error);
        res.status(500).json({
          "error": "An error occurred while updating editor permissions",
        });
      }
    }
  }
}

export default EditorPermissionRoutes;
