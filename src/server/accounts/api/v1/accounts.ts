import express, { Request, Response } from 'express';
import AccountService from '../../service/account';
import ExpressHelper from '../../../common/helper/express';

const handlers = {
    register: async (req: Request, res: Response) => {
        let account = await AccountService.registerNewAccount(req.body.email);
        if ( account ) {
            res.json({message: 'email sent'});
        }
        else {
            res.status(400).json({message: 'error creating account'});
        }
    }

};

var router = express.Router();

/**
 * Register a new account
 * @route POST /api/accounts/v1/register
 * @param email
 * Sends an email to the provided email address to complete the registration process
 */
router.post('/register', ...ExpressHelper.noUserOnly, handlers.register );

export { handlers, router };