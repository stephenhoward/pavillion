import express, { Application } from 'express';
import { EventEmitter } from 'events';

import ActivityPubServerRoutes from '@/server/activitypub/api/v1/server';
import ActivityPubMemberRoutes from '@/server/activitypub/api/v1/members';
import ProcessOutboxService from '@/server/activitypub/service/process_outbox';

class ActivityPubAPI {
    app: Application;
    activityPubRoutes: ActivityPubServerRoutes;
    activityPubMemberRoutes: ActivityPubMemberRoutes;

    constructor(app: Application) {
        this.app = app;

        this.activityPubRoutes = new ActivityPubServerRoutes();
        this.activityPubMemberRoutes = new ActivityPubMemberRoutes();
        let outboxProcessor = new ProcessOutboxService();
        outboxProcessor.registerListeners(this.activityPubMemberRoutes);

        app.use(express.json());
        app.use('/', this.activityPubRoutes.router );
        app.use('/api/v1', this.activityPubMemberRoutes.router );
    }
    registerListeners(source: EventEmitter) {
        this.activityPubMemberRoutes.registerListeners(source);
    }
}

export default ActivityPubAPI;