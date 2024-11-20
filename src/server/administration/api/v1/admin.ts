import express, { Request, Response } from 'express';
import AccountService from '../../../service/account';

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
 * @route POST /api/admin/v1/invite
 * @param email
 * @param message
 * Use a valid password reset code to set a new password
 */
router.post('/invite', adminOnly,
    async (req, res) => {
        AccountService.inviteNewAccount(req.body.email, req.body.message);
        res.json({message: 'invitation sent'});
    }
);

export default router;