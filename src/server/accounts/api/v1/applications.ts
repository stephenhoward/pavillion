import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import AccountsInterface from '@/server/accounts/interface';
import {
  AccountAlreadyExistsError,
  AccountApplicationAlreadyExistsError,
  AccountApplicationsClosedError,
} from '@/server/accounts/exceptions';

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
    try {
      await this.service.applyForNewAccount(req.body.email, req.body.message);
    }
    catch (error) {
      if (error instanceof AccountAlreadyExistsError) {
        // Log internally but don't reveal account existence to requester
        console.info('Application attempted for existing account:', req.body.email);
      }
      else if (error instanceof AccountApplicationAlreadyExistsError) {
        // Log internally but don't reveal application existence to requester
        console.info('Duplicate application attempted for:', req.body.email);
      }
      else if (error instanceof AccountApplicationsClosedError) {
        // This is a system state error, not an enumeration risk, so reveal it
        res.status(400).json({message: 'account_applications_closed'});
        return;
      }
      else {
        // Unexpected error - log and return generic error
        console.error('Error processing application:', error);
        res.status(500).json({message: 'application_processing_error'});
        return;
      }
    }
    // Always return success response to prevent account enumeration
    res.json({message: 'application_submitted'});
  }

  async listApplications(req: Request, res: Response) {
    const applications = await this.service.listAccountApplications();
    res.json(applications);
  }

  async processApplication(req: Request, res: Response) {
    try {
      if (req.body.accepted === true) {
        const account = await this.service.acceptAccountApplication(req.params.id);
        res.json({message: 'application_accepted', account});
      }
      else if (req.body.accepted === false) {
        await this.service.rejectAccountApplication(req.params.id, req.body.silent === true);
        res.json({message: 'application_rejected'});
      }
      else {
        res.status(400).json({message: 'invalid_request'});
      }
    }
    catch (error) {
      // Don't expose internal error details - use generic translation key
      console.error('Error processing application:', error);
      res.status(400).json({message: 'application_processing_error'});
    }
  }
}
