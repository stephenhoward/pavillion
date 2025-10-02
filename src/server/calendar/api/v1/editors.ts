import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarInterface from '../../interface';
import { CalendarEditorPermissionError, EditorAlreadyExistsError, EditorNotFoundError } from '@/common/exceptions/editor';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { noAccountExistsError, AccountInviteAlreadyExistsError } from '@/server/accounts/exceptions';

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
    router.delete('/calendars/:calendarId/editors/:editorId', ExpressHelper.loggedInOnly, this.removeEditAccess.bind(this));

    // Invitation management routes
    router.delete('/calendars/:calendarId/invitations/:invitationId', ExpressHelper.loggedInOnly, this.cancelInvitation.bind(this));
    router.post('/calendars/:calendarId/invitations/:invitationId/resend', ExpressHelper.loggedInOnly, this.resendInvitation.bind(this));

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
      const result = await this.service.listCalendarEditorsWithInvitations(account, req.params.calendarId);
      res.json({
        activeEditors: result.activeEditors.map((editor) => editor.toObject()),
        pendingInvitations: result.pendingInvitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          invitedDate: invitation.expiration_time ? new Date(invitation.expiration_time.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString() : null, // Calculate invited date from expiration
          status: 'pending',
          expiresAt: invitation.expiration_time?.toISOString() || null,
        })),
      });
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
      else if (error instanceof AccountInviteAlreadyExistsError) {
        res.status(409).json({
          "error": "An invitation has already been sent to this email address",
          "errorName": "AccountInviteAlreadyExistsError",
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
   * Supports both owner-initiated revocation and self-revocation
   * (so invited editors can leave the calendar)
   * DELETE /api/v1/calendars/:calendarId/editors/:editorId
   */
  async removeEditAccess(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(401).json({
        "error": "Authentication required",
      });
      return;
    }

    try {
      await this.service.removeEditAccess(account, req.params.calendarId, req.params.editorId);
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

  /**
   * Cancel a pending invitation for a calendar
   * DELETE /api/v1/calendars/:calendarId/invitations/:invitationId
   */
  async cancelInvitation(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(401).json({
        "error": "Authentication required",
      });
      return;
    }

    try {
      const success = await this.service.cancelCalendarInvitation(account, req.params.calendarId, req.params.invitationId);
      if (success) {
        res.status(204).send();
      }
      else {
        res.status(500).json({
          "error": "Failed to cancel invitation",
        });
      }
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
      else if (error.message === 'Invitation not found or not associated with this calendar') {
        res.status(404).json({
          "error": "Invitation not found",
        });
      }
      else {
        console.error("Error canceling invitation:", error);
        res.status(500).json({
          "error": "An error occurred while canceling the invitation",
        });
      }
    }
  }

  /**
   * Resend a pending invitation for a calendar
   * POST /api/v1/calendars/:calendarId/invitations/:invitationId/resend
   */
  async resendInvitation(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(401).json({
        "error": "Authentication required",
      });
      return;
    }

    try {
      const invitation = await this.service.resendCalendarInvitation(account, req.params.calendarId, req.params.invitationId);
      if (invitation) {
        res.json({
          message: "Invitation resent successfully",
          invitation: {
            id: invitation.id,
            email: invitation.email,
            expiresAt: invitation.expiration_time?.toISOString() || null,
          },
        });
      }
      else {
        res.status(500).json({
          "error": "Failed to resend invitation",
        });
      }
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
      else if (error.message === 'Invitation not found or not associated with this calendar') {
        res.status(404).json({
          "error": "Invitation not found",
        });
      }
      else {
        console.error("Error resending invitation:", error);
        res.status(500).json({
          "error": "An error occurred while resending the invitation",
        });
      }
    }
  }
}

export default EditorRoutes;
