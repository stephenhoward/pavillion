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
          error: 'Invalid credentials',
          errorName: 'AuthenticationError',
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
        res.status(400).json({
          error: 'error refreshing token',
          errorName: 'TokenRefreshError',
        });
      }
    }
    else {
      res.status(400).json({
        error: 'error refreshing token',
        errorName: 'TokenRefreshError',
      });
    }
  }

  async checkPasswordResetCode(req: Request, res: Response) {
    const account = await this.service.validatePasswordResetCode(req.params.code);
    if ( account ) {
      const isNewAccount = await this.accountService.isRegisteringAccount(account);
      res.json({ valid: true, isNewAccount: isNewAccount });
    }
    else {
      res.json({ error: 'Invalid or expired password reset code', errorName: 'InvalidPasswordResetCodeError' });
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
        res.status(500).json({
          error: 'error generating password reset code',
          errorName: 'PasswordResetGenerationError',
        });
        return;
      }
    }
    res.json({ success: true });
  }

  async setPassword(req: Request, res: Response) {
    // Validate password before processing
    const passwordValidation = validatePassword(req.body.password || '');
    if (!passwordValidation.valid) {
      res.status(400).json({
        error: passwordValidation.errors[0],
        errorName: passwordValidation.errors[0],
      });
      return;
    }

    let account = await this.service.resetPassword(req.params.code, req.body.password);
    if ( account ) {
      res.send(ExpressHelper.generateJWT(account));
    }
    else {
      res.status(400).json({
        error: 'error resetting password',
        errorName: 'PasswordResetError',
      });
    }
  }

  async changeEmail(req: Request, res: Response) {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', errorName: 'AuthenticationError' });
      return;
    }
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required', errorName: 'ValidationError' });
      return;
    }

    try {
      await this.service.changeEmail(req.user as Account, email, password);
      res.json({ success: true });
    }
    catch (error) {
      if (error instanceof EmailAlreadyExistsError) {
        res.status(409).json({ error: 'email_exists', errorName: 'EmailAlreadyExistsError' });
      }
      else if (error instanceof InvalidPasswordError) {
        res.status(401).json({ error: 'invalid_password', errorName: 'InvalidPasswordError' });
      }
      else {
        logError(error, 'Error changing email');
        res.status(500).json({ error: 'server_error', errorName: 'UnknownError' });
      }
    }
  }
}
