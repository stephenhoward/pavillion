import express, { Application } from 'express';
import ActivityPubServerRoutes from '@/server/activitypub/api/v1/server';
import ActivityPubMemberRoutes from '@/server/activitypub/api/v1/members';
import UserActorRoutes from '@/server/activitypub/api/v1/user-actor';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarInterface from '@/server/calendar/interface';
import UserActorService from '@/server/activitypub/service/user_actor';

export default class ActivityPubAPI {

  static install(app: Application, internalAPI: ActivityPubInterface, calendarAPI: CalendarInterface): void {
    // Scoped to the member API only. The federation routers mounted at '/' below
    // register their own router-level express.json (with activity+json types), and
    // a bare global app.use(express.json()) here would consume raw-body routes like
    // the Stripe webhook (/api/funding/webhooks) and break signatures (pv-ufag).
    app.use('/api/v1', express.json());

    const activityPubRoutes = new ActivityPubServerRoutes(internalAPI,calendarAPI);
    activityPubRoutes.installHandlers(app, '/');

    const activityPubMemberRoutes = new ActivityPubMemberRoutes(internalAPI, calendarAPI);
    activityPubMemberRoutes.installHandlers(app, '/api/v1');

    // Install User Actor routes for Person actor endpoints
    const userActorService = new UserActorService(calendarAPI);
    const userActorRoutes = new UserActorRoutes(userActorService);
    userActorRoutes.installHandlers(app, '/');
  }
}
