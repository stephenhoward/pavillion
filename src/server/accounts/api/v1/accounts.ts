import express, { Request, Response, Application } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import AccountsInterface from '@/server/accounts/interface';
import { AccountAlreadyExistsError, AccountRegistrationClosedError } from '@/server/accounts/exceptions';

export default class AccountRouteHandlers {
  private service: AccountsInterface;

  constructor(internalAPI: AccountsInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.post('/register', ...ExpressHelper.noUserOnly, this.registerHandler.bind(this));
    app.use(routePrefix, router);
  }

  async registerHandler(req: Request, res: Response): Promise<void> {
    try {
      let account = await this.service.registerNewAccount(req.body.email);
      if ( account ) {
        res.json({message: 'email sent'});
      }
      else {
        res.status(400).json({message: 'error creating account'});
      }
    }
    catch (error) {
      if ( error instanceof AccountAlreadyExistsError ) {
        res.status(400).json({message: 'account_exists'});
      }
      else if ( error instanceof AccountRegistrationClosedError ) {
        res.status(400).json({message: 'registration closed'});
      }
      else {
        console.error(error);
        res.status(400).json({message: 'error creating account'});
      }
    }
  }
}
