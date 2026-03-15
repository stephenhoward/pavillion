import express, { Request, Response, Application } from 'express';

import EmailInterface from '@/server/email/interface';

/**
 * Test-only API routes for accessing the in-memory email store.
 *
 * These endpoints are only available when NODE_ENV is not 'production'.
 * They allow Playwright e2e tests to query emails sent by the server
 * (e.g., password reset tokens, invitation codes) without needing
 * direct access to the EmailStore singleton.
 */
class TestEmailRoutes {
  private emailInterface: EmailInterface;

  constructor(emailInterface: EmailInterface) {
    this.emailInterface = emailInterface;
  }

  /**
   * Install test email routes on the Express app.
   * All routes are gated behind a production guard that returns 404.
   */
  installHandlers(app: Application): void {
    const router = express.Router();

    // Production guard: return 404 for all test email routes in production
    router.use((_req: Request, res: Response, next) => {
      if (process.env.NODE_ENV === 'production') {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      next();
    });

    router.get('/emails', this.listEmails.bind(this));
    router.get('/emails/latest', this.getLatestEmail.bind(this));
    router.delete('/emails', this.clearEmails.bind(this));

    app.use('/api/test', router);
  }

  /**
   * List all stored emails, optionally filtered by recipient.
   *
   * GET /api/test/emails
   * GET /api/test/emails?recipient=user@example.com
   */
  async listEmails(req: Request, res: Response) {
    const recipient = req.query.recipient as string | undefined;

    if (recipient) {
      const emails = this.emailInterface.findEmailsByRecipient(recipient);
      res.json({ emails });
      return;
    }

    const emails = this.emailInterface.getAllEmails();
    res.json({ emails });
  }

  /**
   * Get the most recently sent email.
   *
   * GET /api/test/emails/latest
   */
  async getLatestEmail(_req: Request, res: Response) {
    const email = this.emailInterface.getLatestEmail();

    if (!email) {
      res.status(404).json({ error: 'No emails found' });
      return;
    }

    res.json({ email });
  }

  /**
   * Clear all stored emails.
   *
   * DELETE /api/test/emails
   */
  async clearEmails(_req: Request, res: Response) {
    this.emailInterface.clearEmails();
    res.json({ success: true });
  }
}

export default TestEmailRoutes;
