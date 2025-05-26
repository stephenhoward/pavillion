import express, { Application } from 'express';
import ActivityPubServerRoutes from '@/server/activitypub/api/v1/server';
import ActivityPubMemberRoutes from '@/server/activitypub/api/v1/members';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarInterface from '@/server/calendar/interface';

export default class ActivityPubAPI {

  static install(app: Application, internalAPI: ActivityPubInterface, calendarAPI: CalendarInterface): void {
    app.use(express.json());

    const activityPubRoutes = new ActivityPubServerRoutes(internalAPI,calendarAPI);
    activityPubRoutes.installHandlers(app, '/');

    const activityPubMemberRoutes = new ActivityPubMemberRoutes(internalAPI);
    activityPubMemberRoutes.installHandlers(app, '/api/v1');
  }
}
