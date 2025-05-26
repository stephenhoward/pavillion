import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import AccountsInterface from '@/server/accounts/interface';

export default class AccountApplicationRouteHandlers {
  private service: AccountsInterface;

  constructor(service: AccountsInterface) {
    this.service = service;
  }

  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();
    router.post('/applications', ...ExpressHelper.noUserOnly, this.applyToRegister.bind(this));
    router.get('/applications', ...ExpressHelper.adminOnly, this.listApplications.bind(this));
    router.post('/applications/:id', ...ExpressHelper.adminOnly, this.processApplication.bind(this));
    app.use(routePrefix, router);
  }

  async applyToRegister(req: Request, res: Response) {
    await this.service.applyForNewAccount(req.body.email, req.body.message);
    res.json({message: 'application sent'});
  }
  async listApplications(req: Request, res: Response) {
    const applications = await this.service.listAccountApplications();
    res.json(applications);
  }
  async processApplication(req: Request, res: Response) {
    try {
      if (req.body.accepted === true) {
        const account = await this.service.acceptAccountApplication(req.params.id);
        res.json({message: 'application accepted', account});
      }
      else if (req.body.accepted === false) {
        await this.service.rejectAccountApplication(req.params.id, req.body.silent === true);
        res.json({message: 'application rejected'});
      }
      else {
        res.status(400).json({message: 'missing accepted parameter'});
      }
    }
    catch (error) {
      res.status(400).json({message: error.message});
    }
  }
}
