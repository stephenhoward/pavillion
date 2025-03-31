import express, { Request, Response } from 'express';
import AccountService from '../../service/account';
import ExpressHelper from '../../../common/helper/express';
import { AccountAlreadyExistsError, AccountRegistrationClosedError } from '../../exceptions';

const handlers = {
    register: async (req: Request, res: Response) => {
        try {
            let account = await AccountService.registerNewAccount(req.body.email);
            if ( account ) {
                res.json({message: 'email sent'});
            }
            else {
                res.status(400).json({message: 'error creating account'});
            }
        }
        catch (error) {
            if ( error instanceof AccountAlreadyExistsError ) {
                res.status(400).json({message: 'account_exists'});
            }
            else if ( error instanceof AccountRegistrationClosedError ) {
                res.status(400).json({message: 'registration closed'});
            }
            else {
                console.error(error);
                res.status(400).json({message: 'error creating account'});
            }
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