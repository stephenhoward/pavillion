import express, { Request, Response } from 'express';
import AccountService from '../../service/account';
import ExpressHelper from '../../../common/helper/express';

var router = express.Router();

/**
 * Retrieve current registration invitations
 * @route GET /api/accounts/v1/invitations
 */
router.get('/invitations', ExpressHelper.adminOnly,
    async (req: Request, res: Response) => {
        const invitations = await AccountService.listInvitations();
        res.json({invitations});
    }
);

/**
 * Send a registration invitation
 * @route POST /api/accounts/v1/invitations
 * @param email
 * @param message
 * Use a valid password reset code to set a new password
 */
router.post('/invitations', ExpressHelper.adminOnly,
    async (req: Request, res: Response) => {
        AccountService.inviteNewAccount(req.body.email, req.body.message);
        res.json({message: 'invitation sent'});
    }
);

/** 
 * Validate an invitation code
 * @route GET /api/accounts/v1/invitations/:code
 * @param code
 * Check if the provided code is valid
 */
router.get('/invitations/:code', ...ExpressHelper.noUserOnly,
    async (req: Request, res: Response) => {
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
 * @route POST /api/accounts/v1/invitations/:code
 * @param code
 * @param password
 * Accept an invitation to create an account. Provide the password to finish setting up the account
 */
router.post('/invitations/:code', ...ExpressHelper.noUserOnly,
    async (req: Request, res: Response) => {
        let account = await AccountService.acceptAccountInvite(req.params.code, req.body.password);
        if ( account ) {
            ExpressHelper.sendJWT(account, res);
        }
    }
);

export default router;