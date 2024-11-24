import express, { Request, Response } from 'express';
import AccountService from '../../service/account';
import ExpressHelper from '../../../common/helper/express';

const handlers = {
    listInvitations: async (req: Request, res: Response) => {
        const invitations = await AccountService.listInvitations();
        res.json({invitations});
    },
    inviteToRegister: async (req: Request, res: Response) => {
        if( await AccountService.inviteNewAccount(req.body.email, req.body.message) ) {
            res.json({message: 'invitation sent to '+req.body.email});
        }
        else {
            res.status(400);
            res.json({message: 'not ok'});
        }
    },
    checkInviteCode: async (req: Request, res: Response) => {
        if ( await AccountService.validateInviteCode(req.params.code) ) {
            res.json({ message: 'ok' });
        }
        else {
            res.status(404);
            res.json({message: 'not ok'});
        }
    },
    acceptInvite: async (req: Request, res: Response) => {
        let account = await AccountService.acceptAccountInvite(req.params.code, req.body.password);
        if ( account ) {
            res.send(ExpressHelper.generateJWT(account));
        }
        else {
            res.status(400);
            res.json({message: 'not ok'});
        }
    }
};

var router = express.Router();

/**
 * Retrieve current registration invitations
 * @route GET /api/accounts/v1/invitations
 */
router.get('/invitations', ExpressHelper.adminOnly, handlers.listInvitations);

/**
 * Send a registration invitation
 * @route POST /api/accounts/v1/invitations
 * @param email
 * @param message
 * Use a valid password reset code to set a new password
 */
router.post('/invitations', ExpressHelper.adminOnly, handlers.inviteToRegister);

/** 
 * Validate an invitation code
 * @route GET /api/accounts/v1/invitations/:code
 * @param code
 * Check if the provided code is valid
 */
router.get('/invitations/:code', ...ExpressHelper.noUserOnly, handlers.checkInviteCode);

/**
 * Accept an invitation to register
 * @route POST /api/accounts/v1/invitations/:code
 * @param code
 * @param password
 * Accept an invitation to create an account. Provide the password to finish setting up the account
 */
router.post('/invitations/:code', ...ExpressHelper.noUserOnly, handlers.acceptInvite);

export { handlers, router };