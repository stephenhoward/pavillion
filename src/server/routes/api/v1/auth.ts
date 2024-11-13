import express from 'express';
import serverAuth from '../../../authn';
import AccountService from '../../../../service/account';

var router = express.Router();

const noUserOnly = async (req: express.Request, res: express.Response, next: (err?: any) => void) => {
    if ( !req.user ) {
        next();
    }
    else {
        res.status(403).json({message: 'forbidden'});
    }
}

/**
 * Accept login credentials
 * @route POST /api/v1/auth/login
 * @param email
 * @param password
 */
router.post('/login', serverAuth.login );

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
    async (req, res, next) => {
        AccountService.acceptAccountInvite(req.body.code, req.body.password);
        next();
    },
    serverAuth.login
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
    async (req, res, next) => {
        AccountService.resetPassword(req.body.code, req.body.password);
        next()
    },
    serverAuth.login
);

export default router;