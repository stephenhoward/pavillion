import express, { Request, Response } from 'express';

import CreateActivity from '../../model/action/create';
import UpdateActivity from '../../model/action/update';
import DeleteActivity from '../../model/action/delete';
import FollowActivity from '../../model/action/follow';
import AnnounceActivity from '../../model/action/announce';
import UndoActivity from '../../model/action/undo';
import ActivityPubService from '@/server/activitypub/service/server';
import AccountService from '@/server/accounts/service/account';

/**
 * Routes for the ActivityPub Server to Server API
 */
class ActivityPubServerRoutes {
    router: express.Router;
    service: ActivityPubService;

    constructor() {
        this.router = express.Router();
        this.router.get('/.well-known/webfinger', this.lookupUser);
        this.router.get('/users/:user', this.getUserProfile);
        this.router.post('/users/:user/inbox', this.addToInbox);
        this.router.get('/users/:user/outbox', this.readOutbox);

        this.service = new ActivityPubService();
    }

    /** Find user profile location by webfinger resource
     * @params resource - acct:username@domain
     * @returns a WebFingerResponse record
     * reference: https://www.w3.org/community/reports/socialcg/CG-FINAL-apwf-20240608/#forward-discovery
     */
    async lookupUser(req: Request, res: Response) {
        if (typeof req.query.resource === 'string') {
            let { username, domain } = this.service.parseWebFingerResource(req.query.resource);
            let webfingerResponse = await this.service.lookupWebFinger(username, domain);
            if ( webfingerResponse === null ) {
                res.status(404).send('User not found');
            }
            else {
                res.json(webfingerResponse.toObject());
            }
        }
        else {
            res.status(400).send('Invalid request');
        }
    }

    /**
     * Get user actor record by username
     * @params user - username for the profile
     * @returns a UserProfileResponse record
     * reference: https://www.w3.org/TR/activitypub/#actor-objects
     */
    async getUserProfile(req: Request, res: Response) {
        // todo: grab proper domain for this
        let profileResponse = await this.service.lookupUserProfile(req.params.user, 'localhost');
        if ( profileResponse === null ) {
            res.status(404).send('User not found');
        }
        else {
            res.json(profileResponse.toObject());
        }
    }

    /**
     * Add an activity message to a user's inbox
     * @param user - the username of the owner of the inbox
     * @param req.body - the message to add to the inbox
     * reference: https://www.w3.org/TR/activitypub/#server-to-server-interactions
     */
    async addToInbox(req: Request, res: Response) {
        let account = await AccountService.getAccountFromUsername(req.params.user);

        if ( account === null ) {
            res.status(404).send('User not found');
            return;
        }

        // TODO: validate message sender is allowed to send this message
        let message;

        switch(req.body.type) {
            case 'Create':
                message = CreateActivity.fromObject(req.body);
                break;
            case 'Update':
                message = UpdateActivity.fromObject(req.body);
                break;
            case 'Delete':
                message = DeleteActivity.fromObject(req.body);
                break;
            case 'Follow':
                message = FollowActivity.fromObject(req.body);
                break;
            case 'Announce':
                message = AnnounceActivity.fromObject(req.body);
                break;
            case 'Undo':
                message = UndoActivity.fromObject(req.body);
                break;
        }

        if ( message ) {
            await this.service.addToInbox(account, message);
            res.status(200).send('Message received');
        }
        else {
            res.status(400).send('Invalid message');
        }
    }

    /**
     * Read the outbox of a user
     * @param user - the username of the owner of the outbox
     * @returns a list of messages in the outbox
     * reference: https://www.w3.org/TR/activitypub/#outbox
     */
    // TODO: paging or other limits to the quantity of messages returned
    async readOutbox(req: Request, res: Response) {
    }
}

export default ActivityPubServerRoutes;
