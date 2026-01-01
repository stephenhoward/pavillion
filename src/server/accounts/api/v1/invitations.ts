import express, { Request, Response } from 'express';
import { Account } from '@/common/model/account';
import { validatePassword } from '@/common/validation/password';
import AccountsInterface from '@/server/accounts/interface';
import ExpressHelper from '@/server/common/helper/express';

export default class AccountInvitationRouteHandlers {
  private service: AccountsInterface;

  constructor(service: AccountsInterface) {
    this.service = service;
  }

  installHandlers(app: express.Application, routePrefix: string): void {
    var router = express.Router();
    router.get('/invitations', ExpressHelper.loggedInOnly, this.listInvitations.bind(this));
    router.post('/invitations', ExpressHelper.loggedInOnly, this.inviteToRegister.bind(this));
    router.get('/invitations/:code', ...ExpressHelper.noUserOnly, this.checkInviteCode.bind(this));
    router.post('/invitations/:code', ...ExpressHelper.noUserOnly, this.acceptInvite.bind(this));
    router.delete('/invitations/:id', ExpressHelper.adminOnly, this.cancelInvite.bind(this));
    router.post('/invitations/:id/resend', ExpressHelper.adminOnly, this.resendInvite.bind(this));
    app.use(routePrefix, router);
  }

  async listInvitations(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(400).json({ error: 'User not authenticated' });
      return;
    }

    // Admins see all invitations, regular users see only their own
    const inviterId = account.hasRole('admin') ? undefined : account.id;
    const invitations = await this.service.listInvitations(inviterId);

    res.json(invitations.map(inv => inv.toObject()));
  }

  async inviteToRegister(req: Request, res: Response) {
    const invitation = await this.service.inviteNewAccount(req.user! as Account, req.body.email, req.body.message);
    if( invitation ) {
      res.json(invitation);
    }
    else {
      res.status(400);
      res.json({message: 'not ok'});
    }
  }

  async checkInviteCode(req: Request, res: Response) {
    try {
      await this.service.validateInviteCode(req.params.code);
      res.json({ message: 'ok' });
    }
    catch {
      res.status(404);
      res.json({message: 'not ok'});
    }
  }

  async acceptInvite(req: Request, res: Response) {
    // Validate password before processing
    const passwordValidation = validatePassword(req.body.password || '');
    if (!passwordValidation.valid) {
      res.status(400).json({ message: passwordValidation.errors[0] });
      return;
    }

    try {
      const result = await this.service.acceptAccountInvite(req.params.code, req.body.password);

      if (result && result.account) {
        const jwt = ExpressHelper.generateJWT(result.account);

        // If there are calendar contexts, include them in the response
        if (result.calendars && result.calendars.length > 0) {
          res.json({
            jwt,
            calendars: result.calendars,
          });
        }
        else {
          // Maintain backward compatibility for admin invitations without calendar context
          res.send(jwt);
        }
      }
      else {
        res.status(400);
        res.json({message: 'not ok'});
      }
    }
    catch (error) {
      console.error('Error accepting invitation:', error);
      res.status(400);
      res.json({message: 'not ok'});
    }
  }

  async cancelInvite (req: Request, res: Response) {
    const result = await this.service.cancelInvite(req.params.id);
    if (result) {
      res.status(200);
      res.json({ message: 'invitation cancelled successfully' });
    }
    else {
      res.status(404);
      res.json({ message: 'invitation not found' });
    }
  }

  async resendInvite(req: Request, res: Response) {
    const invitation = await this.service.resendInvite(req.params.id);
    if (invitation) {
      res.status(200);
      res.json(invitation);
    }
    else {
      res.status(404);
      res.json({ message: 'invitation not found' });
    }
  }
}
