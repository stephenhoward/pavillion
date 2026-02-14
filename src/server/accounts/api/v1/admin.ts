import express, { Request, Response, Application } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import AccountsInterface from '@/server/accounts/interface';
import { Account } from '@/common/model/account';

export default class AdminAccountRouteHandlers {
  private service: AccountsInterface;

  constructor(internalAPI: AccountsInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    // Admin account listing and management
    router.get('/admin/accounts', ...ExpressHelper.adminOnly, this.listAccounts.bind(this));

    // Admin application management
    router.get('/admin/applications', ...ExpressHelper.adminOnly, this.listApplications.bind(this));
    router.post('/admin/applications/:id/approve', ...ExpressHelper.adminOnly, this.approveApplication.bind(this));
    router.post('/admin/applications/:id/deny', ...ExpressHelper.adminOnly, this.denyApplication.bind(this));

    // Admin invitation management
    router.post('/admin/invitations', ...ExpressHelper.adminOnly, this.sendInvitation.bind(this));
    router.get('/admin/invitations', ...ExpressHelper.adminOnly, this.listInvitations.bind(this));

    app.use(routePrefix, router);
  }

  /**
   * GET /api/v1/admin/accounts
   * List all user accounts with pagination and optional search filtering
   */
  async listAccounts(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search = req.query.search as string | undefined;

      const result = await this.service.listAccounts(page, limit, search);

      res.json(result.accounts.map(account => account.toObject()));
    }
    catch (error) {
      console.error('Error listing accounts:', error);
      res.status(500).json({ error: 'Failed to list accounts' });
    }
  }

  /**
   * GET /api/v1/admin/applications
   * List all pending account applications with pagination
   */
  async listApplications(req: Request, res: Response): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
      const status = req.query.status as string | undefined;

      const result = await this.service.listAccountApplications(page, limit, status);

      res.json({
        applications: result.applications,
        pagination: result.pagination,
      });
    }
    catch (error) {
      console.error('Error listing applications:', error);
      res.status(500).json({ error: 'Failed to list applications' });
    }
  }

  /**
   * POST /api/v1/admin/applications/:id/approve
   * Approve an account application and create the user account
   */
  async approveApplication(req: Request, res: Response): Promise<void> {
    try {
      const applicationId = req.params.id;

      if (!applicationId) {
        res.status(400).json({ error: 'Application ID is required', errorName: 'ValidationError' });
        return;
      }

      const account = await this.service.acceptAccountApplication(applicationId);

      res.json({
        account: account.toObject(),
        message: 'Application approved successfully',
      });
    }
    catch (error) {
      console.error('Error approving application:', error);
      res.status(500).json({ error: 'Failed to approve application' });
    }
  }

  /**
   * POST /api/v1/admin/applications/:id/deny
   * Deny an account application
   */
  async denyApplication(req: Request, res: Response): Promise<void> {
    try {
      const applicationId = req.params.id;
      const silent = req.body.silent === true;

      if (!applicationId) {
        res.status(400).json({ error: 'Application ID is required', errorName: 'ValidationError' });
        return;
      }

      await this.service.rejectAccountApplication(applicationId, silent);

      res.json({
        success: true,
        message: 'Application denied successfully',
      });
    }
    catch (error) {
      console.error('Error denying application:', error);
      res.status(500).json({ error: 'Failed to deny application' });
    }
  }

  /**
   * POST /api/v1/admin/invitations
   * Send a new account invitation
   */
  async sendInvitation(req: Request, res: Response): Promise<void> {
    try {
      const admin = req.user as Account;
      const { email, message } = req.body;

      if (!email) {
        res.status(400).json({ error: 'Email is required', errorName: 'ValidationError' });
        return;
      }

      if (!admin) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const invitation = await this.service.inviteNewAccount(
        admin,
        email,
        message || '',
      );

      res.status(201).json({
        invitation: invitation.toObject(),
        message: 'Invitation sent successfully',
      });
    }
    catch (error) {
      console.error('Error sending invitation:', error);
      res.status(500).json({ error: 'Failed to send invitation' });
    }
  }

  /**
   * GET /api/v1/admin/invitations
   * List all account invitations with pagination (admin sees all invitations)
   */
  async listInvitations(req: Request, res: Response): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));

      // Admin gets all invitations (inviterId = undefined)
      const result = await this.service.listInvitations(page, limit);

      res.json({
        invitations: result.invitations.map(inv => inv.toObject()),
        pagination: result.pagination,
      });
    }
    catch (error) {
      console.error('Error listing invitations:', error);
      res.status(500).json({ error: 'Failed to list invitations' });
    }
  }
}
