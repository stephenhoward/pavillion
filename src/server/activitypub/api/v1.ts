import express, { Application } from 'express';
import { EventEmitter } from 'events';

import ActivityPubServerRoutes from '@/server/activitypub/api/v1/server';
import ActivityPubMemberRoutes from '@/server/activitypub/api/v1/members';

class ActivityPubAPI {
    app: Application;
    activityPubRoutes: ActivityPubServerRoutes;
    activityPubMemberRoutes: ActivityPubMemberRoutes;

    constructor(app: Application) {
        this.app = app;

        this.activityPubRoutes = new ActivityPubServerRoutes();
        this.activityPubMemberRoutes = new ActivityPubMemberRoutes();
        app.use(express.json());
        app.use('/', this.activityPubRoutes.router );
        app.use('/api/v1', this.activityPubMemberRoutes.router );
    }
    registerListeners(source: EventEmitter) {
        this.activityPubMemberRoutes.registerListeners(source);
    }
}

export default ActivityPubAPI;