import express, { Request, Response } from 'express';
import AccountService from '../../service/account';
import ExpressHelper from '../../../common/helper/express';

var router = express.Router();

/**
 * Register a new account
 * @route POST /api/accounts/v1/register
 * @param email
 * Sends an email to the provided email address to complete the registration process
 */
router.post('/register',
    ExpressHelper.noUserOnly,
    async (req, res) => {
        AccountService.registerNewAccount(req.body.email);
        res.json({message: 'register'})
    }
);

export default router;