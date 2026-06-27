import express, { Request, Response, Application } from 'express';
import passport from 'passport';

import { Account } from '@/common/model/account';
import { validatePassword } from '@/common/validation/password';
import ExpressHelper from '@/server/common/helper/express';
import { noAccountExistsError } from '@/server/accounts/exceptions';
import AccountsInterface from '@/server/accounts/interface';
import { InvalidPasswordError } from '@/server/authentication/exceptions';
import AuthenticationInterface from '@/server/authentication/interface';
import { logError } from '@/server/common/helper/error-logger';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('authentication');
import {
  limitPasswordResetByIp,
  limitPasswordResetByEmail,
  limitConfirmPasswordResetByIp,
  limitLoginByIp,
  limitLoginByEmail,
  limitEmailChangeByAccount,
  limitEmailChangeByDestination,
  limitConfirmEmailChangeByIp,
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

    router.post('/login', limitLoginByIp, limitLoginByEmail, ...ExpressHelper.noUserOnly, this.login.bind(this) );
    router.get('/token', ...ExpressHelper.loggedInOnly, this.getToken.bind(this) );
    router.get('/reset-password/:code', this.checkPasswordResetCode.bind(this) );
    router.post('/reset-password', limitPasswordResetByIp, limitPasswordResetByEmail, this.generatePasswordResetCode.bind(this) );
    router.post('/reset-password/:code', limitConfirmPasswordResetByIp, this.setPassword.bind(this) );
    // CRITICAL: the confirm route is registered BEFORE `/email` so the static
    // `confirm` segment can never be shadowed by a future `/email/:param` or
    // `/email/*` wildcard (Express matches in registration order; mirrors the
    // applications.ts confirm/:token discipline). This endpoint is anonymous:
    // the URL-path token IS the bearer credential, so no session middleware and
    // no CSRF token are applied — either would break the email-link flow. Only
    // an IP limiter guards it (epic pv-91a3).
    router.post('/email/confirm/:token', limitConfirmEmailChangeByIp, this.confirmEmailChange.bind(this) );
    router.post('/email', ...ExpressHelper.loggedInOnly, limitEmailChangeByAccount, limitEmailChangeByDestination, this.changeEmail.bind(this) );
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
        logger.info('Password reset code requested for non-existent account');
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
      // initiateEmailChange NEVER throws EmailAlreadyExistsError: the available,
      // taken, and no-op outcomes all resolve to the same uniform 200
      // {success:true} below, so the response carries no signal about which
      // emails are already registered. This closes the 409-vs-200 enumeration
      // oracle the old synchronous changeEmail exposed (epic pv-91a3, DEC-004).
      await this.service.initiateEmailChange(req.user as Account, email, password);
      res.json({ success: true });
    }
    catch (error) {
      // InvalidPasswordError is the only retained throw: the caller is probing
      // with their OWN password, so a password-validity signal leaks no email
      // existence (epic pv-91a3, out-of-scope OQ2).
      if (error instanceof InvalidPasswordError) {
        res.status(401).json({ error: 'invalid_password', errorName: 'InvalidPasswordError' });
      }
      else {
        logError(error, 'Error changing email');
        res.status(500).json({ error: 'server_error', errorName: 'UnknownError' });
      }
    }
  }

  /**
   * POST /api/auth/v1/email/confirm/:token
   * Anonymous endpoint that consumes an email-change confirmation token and
   * commits the pending address. The path token IS the bearer credential, so
   * the route carries no session and no CSRF guard. Every terminal failure
   * (bad format / unknown / expired / already-consumed / address-now-taken /
   * DB error) collapses to a single uniform `{ valid: false }` (HTTP 200) so a
   * caller cannot distinguish them — the address-now-taken branch is explicitly
   * indistinguishable from token-expiry (anti-enumeration; epic pv-91a3,
   * DEC-004). The collapse lives in the service (confirmEmailChange returns a
   * boolean) to avoid a handler catch block that would enumerate the error set;
   * tokens are never logged. Mirrors accounts/api/v1/applications.ts
   * consumeConfirmationToken.
   */
  async confirmEmailChange(req: Request, res: Response) {
    const success = await this.service.confirmEmailChange(req.params.token);
    if (success) {
      res.json({ success: true });
    }
    else {
      res.json({ valid: false });
    }
  }
}
