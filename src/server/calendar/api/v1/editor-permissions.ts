import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarInterface from '../../interface';
import { CalendarEditorPermissionError, EditorNotFoundError } from '@/common/exceptions/editor';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { ValidationError } from '@/common/exceptions/base';
import { logError } from '@/server/common/helper/error-logger';

class EditorPermissionRoutes {
  private calendarInterface: CalendarInterface;

  constructor(internalAPI: CalendarInterface) {
    this.calendarInterface = internalAPI;
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
        "errorName": "AuthenticationError",
      });
      return;
    }

    const { canReviewReports } = req.body;

    // Validate request format
    if (typeof canReviewReports !== 'boolean') {
      const validationError = new ValidationError(
        "Missing or invalid 'canReviewReports' in request body. Must be a boolean.",
      );
      ExpressHelper.sendValidationError(res, validationError);
      return;
    }

    try {
      const updatedMember = await this.calendarInterface.updateEditorPermissions(
        account,
        req.params.calendarId,
        req.params.editorId,
        { canReviewReports },
      );

      res.json(updatedMember.toObject());
    }
    catch (error) {
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof CalendarEditorPermissionError) {
        res.status(403).json({
          "error": error.message,
          "errorName": "CalendarEditorPermissionError",
        });
      }
      else if (error instanceof CalendarNotFoundError) {
        res.status(404).json({
          "error": error.message,
          "errorName": "CalendarNotFoundError",
        });
      }
      else if (error instanceof EditorNotFoundError) {
        res.status(404).json({
          "error": error.message,
          "errorName": "EditorNotFoundError",
        });
      }
      else {
        logError(error, 'Error updating editor permissions');
        res.status(500).json({
          "error": "An error occurred while updating editor permissions",
          "errorName": "InternalServerError",
        });
      }
    }
  }
}

export default EditorPermissionRoutes;
