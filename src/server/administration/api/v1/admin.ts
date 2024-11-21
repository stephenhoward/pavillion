import express, { Request, Response } from 'express';
import AccountService from '../../service/account';

interface User {
    id: number;
    name: string;
    email: string;
    role: string;
    hasRole(role: string): boolean;
}

declare module 'express-serve-static-core' {
    interface Request {
        user?: User;
    }
}
var router = express.Router();

const adminOnly = async (req: Request, res: Response, next: (err?: any) => void) => {
    if ( req.user && req.user.hasRole('admin') ) {
        next();
    }
    else {
        res.status(403).json({message: 'forbidden'});
    }
}

/**
 * Send a registration invitation
 * @route POST /api/admin/v1/invitations
 * @param email
 * @param message
 * Use a valid password reset code to set a new password
 */
router.post('/invitations', adminOnly,
    async (req, res) => {
        AccountService.inviteNewAccount(req.body.email, req.body.message);
        res.json({message: 'invitation sent'});
    }
);

/**
 * Retrieve current registration invitations
 * @route GET /api/admin/v1/invitations
 */
router.get('/invitations', adminOnly,
    async (req, res) => {
        const invitations = await AccountService.listInvitations();
        res.json({invitations: invitations});
    }
);

/**
 * Process a registration application
 * @route POST /api/admin/v1/applications/:id
 * @param id
 * @param accepted
 */
router.post('/applications/:id', adminOnly,
    async (req, res) => {
        if ( req.body.accepted == true ) {
            AccountService.acceptAccountApplication(req.params.id);
            res.json({message: 'application accepted'});
        }
        else if ( req.body.accepted == false ) {
            AccountService.rejectAccountApplication(req.params.id);
            res.json({message: 'application rejected'});
        }
        else {
            res.status(400).json({message: 'missing accepted parameter'});
        }
    }

)


export default router;