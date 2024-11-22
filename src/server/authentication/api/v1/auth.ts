import express, { Response } from 'express';
import AuthenticationService from '../../service/auth';
import CommonAccountService from '../../../common/service/accounts';
import passport from 'passport';
import { Account } from '../../../../common/model/account';
import ExpressHelper from '../../../common/helper/express';

var router = express.Router();

/**
 * Accept login credentials
 * @route POST /api/auth/v1/login
 * @param email
 * @param password
 */
router.post('/login',
    ...ExpressHelper.noUserOnly,
    async(req, res) => {
        passport.authenticate('local', {session: false}, (err: any, account: Account, info?: any) => {
            if (err || !account) {
                return res.status(400).json({
                    message: 'Something is not right',
                    user   : account
                });
            }
            req.login(account, {session: false}, (err: any) => {
                if (err) {
                    res.send(err);
                }
                ExpressHelper.sendJWT(account, res);
            });
        })(req, res);
    }
);

/**
 * Re-issue a token with a fresh expiration time
 * @route POST /api/auth/v1/token
 * Only succeeds if the token provided in the request is still valid
 */
router.get('/token',
    ...ExpressHelper.loggedInOnly,
    async (req, res) => {
        if ( req.user ) {
            const account = await CommonAccountService.getAccountById(req.user.id);
            if ( account ) {
                ExpressHelper.sendJWT(account, res);
            }
        }
    }
);

/**
 * Validate a password reset code
 * @route GET /api/auth/v1/reset-password/:code
 * @param code
 * Check if the password reset code is valid, including that it's timestamp is not expired
 */
router.get('/reset-password/:code', async (req, res) => {
    if ( await AuthenticationService.validatePasswordResetCode(req.params.code) ) {
        res.json({ message: 'ok' });
    }
    else {
        res.json({message: 'not ok'});
    }
});

/**
 * Reset a password
 * @route POST /api/auth/v1/reset-password
 * @param code
 * @param password
 * Use a valid password reset code to set a new password
 */
router.post('/reset-password',
    async (req, res) => {
        let account = await AuthenticationService.resetPassword(req.body.code, req.body.password);
        if ( account ) {
            ExpressHelper.sendJWT(account, res);
        }
    }
);

export default router;