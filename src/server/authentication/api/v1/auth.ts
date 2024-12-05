import express, { Request, Response } from 'express';
import AuthenticationService from '../../service/auth';
import CommonAccountService from '../../../common/service/accounts';
import passport from 'passport';
import { Account } from '../../../../common/model/account';
import ExpressHelper from '../../../common/helper/express';

const handlers = {
    login: async (req: Request, res: Response) => {
        passport.authenticate('local', {session: false}, (err: any, account: Account, info?: any) => {
            if (err || !account) {
                return res.status(400).json({
                    message: 'Something is not right',
                    user   : account
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
        if ( await AuthenticationService.validatePasswordResetCode(req.params.code) ) {
            res.json({ message: 'ok' });
        }
        else {
            res.json({message: 'not ok'});
        }
    },
    resetPassword: async (req: Request, res: Response) => {
        let account = await AuthenticationService.resetPassword(req.body.code, req.body.password);
        if ( account ) {
            res.send(ExpressHelper.generateJWT(account));
        }
        else {
            res.status(400).json({message: 'error resetting password' });
        }
    }
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
 * Reset a password
 * @route POST /api/auth/v1/reset-password
 * @param code
 * @param password
 * Use a valid password reset code to set a new password
 */
router.post('/reset-password', handlers.resetPassword );

export { handlers, router };