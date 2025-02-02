import express, { Request, Response } from 'express';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import ActivityPubService from '@/server/activitypub/service/server';
import ActivityPubMemberService from '@/server/activitypub/service/members'

class ActivityPubMemberRoutes {
    router: express.Router;
    service: ActivityPubMemberService;

    constructor() {
        this.router = express.Router();
        this.router.post('/social/follows', ExpressHelper.loggedInOnly, this.followAccount);
        this.router.delete('/social/follows/:id', ExpressHelper.loggedInOnly, this.unfollowAccount);
        this.router.post('/social/shares', ExpressHelper.loggedInOnly, this.shareEvent);
        this.router.delete('/social/shares/:id', ExpressHelper.loggedInOnly, this.unshareEvent);

        this.service = new ActivityPubMemberService();
    }

    registerListeners(source: EventEmitter) {
        this.service.registerListeners(source);
    }

    // TODO: Catch error if service throws because target does not exist
    async followAccount(req: Request, res: Response) {
        const account = req.user as Account;

        if (!account) {
            res.status(403).send("Not logged in");
            return;
        }

        if (typeof req.body.remoteAccount === 'string') {
            await this.service.followAccount(account, req.body.remoteAccount);
            res.status(200).send('Followed');
        }
        else {
            res.status(400).send('Invalid request');
        }
    }

    // TODO: Catch error if service throws because target does not exist
    async unfollowAccount(req: Request, res: Response) {
        const account = req.user as Account;

        if (!account) {
            res.status(403).send("Not logged in");
            return;
        }

        if (typeof req.params.id === 'string') {
            await this.service.unfollowAccount(account, req.params.id);
            res.status(200).send('Unfollowed');
        }
        else {
            res.status(400).send('Invalid request');
        }
    }

    // TODO: Catch error if service throws because target does not exist
    async shareEvent(req: Request, res: Response) {
        const account = req.user as Account;

        if (!account) {
            res.status(403).send("Not logged in");
            return;
        }

        if (typeof req.body.eventId === 'string') {
            await this.service.shareEvent(account, req.body.eventId);
            res.status(200).send('Shared');
        }
        else {
            res.status(400).send('Invalid request');
        }
    }

    // TODO: Catch error if service throws because target does not exist
    async unshareEvent(req: Request, res: Response) {
        const account = req.user as Account;

        if (!account) {
            res.status(403).send("Not logged in");
            return;
        }

        if (typeof req.params.id === 'string') {
            await this.service.unshareEvent(account, req.params.id);
            res.status(200).send('Unshared');
        }
        else {
            res.status(400).send('Invalid request');
        }
    }
}

export default ActivityPubMemberRoutes;