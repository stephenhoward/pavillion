import express, { Request, Response } from 'express';
import passport from 'passport';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CommonAccountService from '@/server/common/service/accounts';
import AuthenticationService from '@/server/authentication/service/auth';
import { noAccountExistsError } from '@/server/accounts/exceptions';
import { EmailAlreadyExistsError, InvalidPasswordError } from '@/server/authentication/exceptions';
import AccountService from '@/server/accounts/service/account';

const handlers = {
  login: async (req: Request, res: Response) => {
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
  },
  getToken: async (req: Request, res: Response) => {
    if ( req.user ) {
      const account = await CommonAccountService.getAccountById(req.user.id);
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
  },
  checkPasswordResetCode: async (req: Request, res: Response) => {
    const account = await AuthenticationService.validatePasswordResetCode(req.params.code);
    if ( account ) {
      const isNewAccount = await AccountService.isRegisteringAccount(account);
      res.json({ message: 'ok', isNewAccount: isNewAccount });
    }
    else {
      res.json({message: 'not ok'});
    }
  },
  generatePasswordResetCode: async (req: Request, res: Response) => {
    try {
      await AuthenticationService.generatePasswordResetCode(req.body.email);
    }
    catch (error) {
      if ( error instanceof noAccountExistsError ) {
        console.info('Password reset code requested for non-existent account');
      }
      else {
        console.error(error);
        res.status(400).json({message: 'error generating password reset code'});
        return;
      }
    }
    res.json({ message: 'ok' });
  },
  setPassword: async (req: Request, res: Response) => {
    let account = await AuthenticationService.resetPassword(req.params.code, req.body.password);
    if ( account ) {
      res.send(ExpressHelper.generateJWT(account));
    }
    else {
      res.status(400).json({message: 'error resetting password' });
    }
  },
  changeEmail: async (req: Request, res: Response) => {
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
      await AuthenticationService.changeEmail(req.user as Account, email, password);
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
        console.error('Error changing email:', error);
        res.status(500).json({ message: 'server_error' });
      }
    }
  },
};

var router = express.Router();

/**
 * Accept login credentials
 * @route POST /api/auth/v1/login
 * @param email
 * @param password
 */
router.post('/login', ...ExpressHelper.noUserOnly, handlers.login );

/**
 * Re-issue a token with a fresh expiration time
 * @route POST /api/auth/v1/token
 * Only succeeds if the token provided in the request is still valid
 */
router.get('/token', ...ExpressHelper.loggedInOnly, handlers.getToken );

/**
 * Validate a password reset code
 * @route GET /api/auth/v1/reset-password/:code
 * @param code
 * Check if the password reset code is valid, including that it's timestamp is not expired
 */
router.get('/reset-password/:code', handlers.checkPasswordResetCode );

/**
 * Generate a password reset code
 * @route POST /api/auth/v1/reset-password
 * @param email
 * Generate a password reset code and send it to the email address provided
 */
router.post('/reset-password', handlers.generatePasswordResetCode );

/**
 * Reset a password
 * @route POST /api/auth/v1/reset-password/CODE
 * @param code
 * @param password
 * Use a valid password reset code to set a new password
 */
router.post('/reset-password/:code', handlers.setPassword );

/**
 * Change email address
 * @route POST /api/auth/v1/email
 * @param email
 * @param password
 * Change the logged in user's email address after verifying their password
 */
router.post('/email', ...ExpressHelper.loggedInOnly, handlers.changeEmail );


export { handlers, router };
