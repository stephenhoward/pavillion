import express, { Request, Response } from 'express';
import { Account } from '@/common/model/account';
import AccountsInterface from '@/server/accounts/interface';
import ExpressHelper from '@/server/common/helper/express';

export default class AccountInvitationRouteHandlers {
  private service: AccountsInterface;

  constructor(service: AccountsInterface) {
    this.service = service;
  }

  installHandlers(app: express.Application, routePrefix: string): void {
    var router = express.Router();
    router.get('/invitations', ExpressHelper.adminOnly, this.listInvitations.bind(this));
    router.post('/invitations', ExpressHelper.loggedInOnly, this.inviteToRegister.bind(this));
    router.get('/invitations/:code', ...ExpressHelper.noUserOnly, this.checkInviteCode.bind(this));
    router.post('/invitations/:code', ...ExpressHelper.noUserOnly, this.acceptInvite.bind(this));
    router.delete('/invitations/:id', ExpressHelper.adminOnly, this.cancelInvite.bind(this));
    router.post('/invitations/:id/resend', ExpressHelper.adminOnly, this.resendInvite.bind(this));
    app.use(routePrefix, router);
  }

  async listInvitations(req: Request, res: Response) {
    const invitations = await this.service.listInvitations();
    res.json(invitations);
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
    if ( await this.service.validateInviteCode(req.params.code) ) {
      res.json({ message: 'ok' });
    }
    else {
      res.status(404);
      res.json({message: 'not ok'});
    }
  }

  async acceptInvite(req: Request, res: Response) {
    let account = await this.service.acceptAccountInvite(req.params.code, req.body.password);
    if ( account ) {
      res.send(ExpressHelper.generateJWT(account));
    }
    else {
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
