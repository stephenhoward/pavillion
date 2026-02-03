import express, { Request, Response, Application } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import AccountsInterface from '@/server/accounts/interface';
import { AccountAlreadyExistsError, AccountRegistrationClosedError } from '@/server/accounts/exceptions';
import { Account } from '@/common/model/account';

export default class AccountRouteHandlers {
  private service: AccountsInterface;

  constructor(internalAPI: AccountsInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.post('/register', ...ExpressHelper.noUserOnly, this.registerHandler.bind(this));
    router.get('/accounts/me', ...ExpressHelper.loggedInOnly, this.getCurrentUser.bind(this));
    router.patch('/accounts/me/profile', ...ExpressHelper.loggedInOnly, this.updateProfile.bind(this));
    app.use(routePrefix, router);
  }

  async registerHandler(req: Request, res: Response): Promise<void> {
    try {
      let account = await this.service.registerNewAccount(req.body.email);
      if ( !account ) {
        res.status(400).json({message: 'error_creating_account'});
        return;
      }
    }
    catch (error) {
      if ( error instanceof AccountAlreadyExistsError ) {
        console.info('Registration attempt for existing account');
      }
      else if ( error instanceof AccountRegistrationClosedError ) {
        res.status(400).json({message: 'registration_closed'});
        return;
      }
      else {
        console.error(error);
        res.status(400).json({message: 'error_creating_account'});
        return;
      }
    }
    res.json({message: 'registration_submitted'});
  }

  async getCurrentUser(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;

    if (!account) {
      res.status(400).json({
        error: 'User not authenticated',
      });
      return;
    }

    res.json(account.toObject());
  }

  async updateProfile(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;

    if (!account) {
      res.status(400).json({
        error: 'User not authenticated',
      });
      return;
    }

    const { displayName } = req.body;

    if (displayName === undefined) {
      res.status(400).json({
        error: 'displayName is required',
      });
      return;
    }

    try {
      const updatedAccount = await this.service.updateProfile(account, displayName);
      res.json(updatedAccount.toObject());
    }
    catch (error) {
      console.error('Error updating profile:', error);
      res.status(500).json({
        error: 'An error occurred while updating the profile',
      });
    }
  }
}
