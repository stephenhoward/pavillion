import express, { Response } from 'express';
import AccountService from '../../service/account';
import passport from 'passport';
import { Account } from '../../../../common/model/account';
import jwt from 'jsonwebtoken';

var router = express.Router();
const jwtSecret = 'secret';  // TODO: add secret here

const noUserOnly = async (req: express.Request, res: express.Response, next: (err?: any) => void) => {
    if ( !req.user ) {
        next();
    }
    else {
        res.status(403).json({message: 'forbidden'});
    }
}

const sendJWT = (account: Account, res: Response) => {
    // generate a signed json web token with the contents of user object and return it in the response
    let payload = {id: account.id, isAdmin: account.hasRole('admin')};
    let token = jwt.sign(payload, jwtSecret);
    return res.json({payload, token});
}

/**
 * Accept login credentials
 * @route POST /api/v1/auth/login
 * @param email
 * @param password
 */
router.post('/login',
    noUserOnly,
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
                sendJWT(account, res);
            });
        })(req, res);
    }
);

/**
 * Register a new account
 * @route POST /api/v1/auth/register
 * @param email
 * Sends an email to the provided email address to complete the registration process
 */
router.post('/register',
    noUserOnly,
    async (req, res) => {
        AccountService.registerNewAccount(req.body.email);
        res.json({message: 'register'})
    }
);

/**
 * Apply for a new account
 * @route POST /api/v1/auth/register-apply
 * @param email
 * @param message
 * If the server is not configured to allow open registrations, this will send store a request
 * for an account that the server administrator can approve
 */
router.post('/register-apply',
    noUserOnly,
    async (req, res) => {
        AccountService.applyForNewAccount(req.body.email, req.body.message);
        res.json({message: 'application sent'})
    }
);

/** 
 * Validate an invitation code
 * @route GET /api/v1/auth/register-invitation/:code
 * @param code
 * Check if the provided code is valid
 */
router.get('/register-invitation/:code',
    noUserOnly,
    async (req, res) => {
        if ( await AccountService.validateInviteCode(req.params.code) ) {
            res.json({ message: 'ok' });
        }
        else {
            res.json({message: 'not ok'});
        }
    }
);

/**
 * Accept an invitation to register
 * @route POST /api/v1/auth/register-invitation
 * @param code
 * @param password
 * Accept an invitation to create an account. Provide the password to finish setting up the account
 */
router.post('/register-invitation',
    noUserOnly,
    async (req, res) => {
        let account = await AccountService.acceptAccountInvite(req.body.code, req.body.password);
        if ( account ) {
            sendJWT(account, res);
        }
    }
);

/**
 * Validate a password reset code
 * @route GET /api/v1/auth/reset-password/:code
 * @param code
 * Check if the password reset code is valid, including that it's timestamp is not expired
 */
router.get('/reset-password/:code', async (req, res) => {
    if ( await AccountService.validatePasswordResetCode(req.params.code) ) {
        res.json({ message: 'ok' });
    }
    else {
        res.json({message: 'not ok'});
    }
});

/**
 * Reset a password
 * @route POST /api/v1/auth/reset-password
 * @param code
 * @param password
 * Use a valid password reset code to set a new password
 */
router.post('/reset-password',
    async (req, res) => {
        let account = await AccountService.resetPassword(req.body.code, req.body.password);
        if ( account ) {
            sendJWT(account, res);
        }
    }
);

export default router;