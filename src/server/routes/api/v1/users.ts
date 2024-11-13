import express, { Request, Response } from 'express';
import AccountService from '../../../../service/account';

var router = express.Router();

const adminOnly = async (req: Request, res: Response, next: (err?: any) => void) => {
    if ( req.user && req.user ) { //.role === 'admin' ) {
        next();
    }
    else {
        res.status(403).json({message: 'forbidden'});
    }
}

router.post('/invite', adminOnly,
    async (req, res) => {
        AccountService.inviteNewAccount(req.body.email, req.body.message);
        res.json({message: 'invitation sent'});
    }
);

export default router;