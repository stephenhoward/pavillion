import express, { Request, Response } from 'express';
import AccountService from '../../service/account';
import ExpressHelper from '../../../common/helper/express';

var router = express.Router();

/**
 * Apply for a new account
 * @route POST /api/accounts/v1/applications
 * @param email
 * @param message
 * If the server is not configured to allow open registrations, this will send store a request
 * for an account that the server administrator can approve
 */
router.post('/applications', ExpressHelper.noUserOnly,
    async (req, res) => {
        AccountService.applyForNewAccount(req.body.email, req.body.message);
        res.json({message: 'application sent'})
    }
);

/**
 * Retrieve current registration applications
 * @route GET /api/accounts/v1/applications
 */
router.get('/applications', ExpressHelper.adminOnly,
    async (req, res) => {
        const applications = await AccountService.listAccountApplications();
        res.json({applications});
    }
);

/**
 * Process a registration application
 * @route POST /api/accounts/v1/applications/:id
 * @param id
 * @param accepted
 */
router.post('/applications/:id', ExpressHelper.adminOnly,
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