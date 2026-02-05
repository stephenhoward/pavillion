import express, { Request, Response, Application } from 'express';
import passport from 'passport';

import { Account } from '@/common/model/account';
import { validatePassword } from '@/common/validation/password';
import ExpressHelper from '@/server/common/helper/express';
import { noAccountExistsError } from '@/server/accounts/exceptions';
import AccountsInterface from '@/server/accounts/interface';
import { EmailAlreadyExistsError, InvalidPasswordError } from '@/server/authentication/exceptions';
import AuthenticationInterface from '@/server/authentication/interface';
import { logError } from '@/server/common/helper/error-logger';
import {
  passwordResetByIp,
  passwordResetByEmail,
  loginByIp,
  loginByEmail,
} from '@/server/common/middleware/rate-limiters';

export default class AuthenticationRouteHandlers {
  private service: AuthenticationInterface;
  private accountService: AccountsInterface;

  constructor(internalAPI: AuthenticationInterface, accountsAPI: AccountsInterface) {
    this.service = internalAPI;
    this.accountService = accountsAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    router.post('/login', loginByIp, loginByEmail, ...ExpressHelper.noUserOnly, this.login.bind(this) );
    router.get('/token', ...ExpressHelper.loggedInOnly, this.getToken.bind(this) );
    router.get('/reset-password/:code', this.checkPasswordResetCode.bind(this) );
    router.post('/reset-password', passwordResetByIp, passwordResetByEmail, this.generatePasswordResetCode.bind(this) );
    router.post('/reset-password/:code', this.setPassword.bind(this) );
    router.post('/email', ...ExpressHelper.loggedInOnly, this.changeEmail.bind(this) );
    app.use(routePrefix, router);
  }

  async login(req: Request, res: Response) {
    passport.authenticate('local', {session: false}, (err: any, account: Account) => {
      if (err || !account) {
        return res.status(400).json({
          message: 'Something is not right',
          user   : account,
        });
      }

      req.user = account;
      res.send(ExpressHelper.generateJWT(account));
    })(req, res);
  }

  async getToken(req: Request, res: Response) {
    if ( req.user ) {
      const account = await this.accountService.getAccountById(req.user.id);
      if ( account ) {
        res.send(ExpressHelper.generateJWT(account));
      }
      else {
        res.status(400).json({message: 'error refreshing token'});
      }
    }
    else {
      res.status(400).json({message: 'error refreshing token'});
    }
  }

  async checkPasswordResetCode(req: Request, res: Response) {
    const account = await this.service.validatePasswordResetCode(req.params.code);
    if ( account ) {
      const isNewAccount = await this.accountService.isRegisteringAccount(account);
      res.json({ message: 'ok', isNewAccount: isNewAccount });
    }
    else {
      res.json({message: 'not ok'});
    }
  }

  async generatePasswordResetCode(req: Request, res: Response) {
    try {
      await this.service.generatePasswordResetCode(req.body.email);
    }
    catch (error) {
      if ( error instanceof noAccountExistsError ) {
        console.info('Password reset code requested for non-existent account');
      }
      else {
        logError(error, 'Error generating password reset code');
        res.status(500).json({message: 'error generating password reset code'});
        return;
      }
    }
    res.json({ message: 'ok' });
  }

  async setPassword(req: Request, res: Response) {
    // Validate password before processing
    const passwordValidation = validatePassword(req.body.password || '');
    if (!passwordValidation.valid) {
      res.status(400).json({ message: passwordValidation.errors[0] });
      return;
    }

    let account = await this.service.resetPassword(req.params.code, req.body.password);
    if ( account ) {
      res.send(ExpressHelper.generateJWT(account));
    }
    else {
      res.status(400).json({message: 'error resetting password' });
    }
  }

  async changeEmail(req: Request, res: Response) {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required' });
      return;
    }

    try {
      await this.service.changeEmail(req.user as Account, email, password);
      res.json({ message: 'ok' });
    }
    catch (error) {
      if (error instanceof EmailAlreadyExistsError) {
        res.status(409).json({ message: 'email_exists' });
      }
      else if (error instanceof InvalidPasswordError) {
        res.status(401).json({ message: 'invalid_password' });
      }
      else {
        logError(error, 'Error changing email');
        res.status(500).json({ message: 'server_error' });
      }
    }
  }
}
