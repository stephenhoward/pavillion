import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarService from '@/server/calendar/service/calendar';
import ActivityPubInterface from '@/server/activitypub/interface';

export default class ActivityPubMemberRoutes {
  private service: ActivityPubInterface;

  constructor(internalAPI: ActivityPubInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.post('/social/follows', ExpressHelper.loggedInOnly, this.requireCalendarId, this.followCalendar);
    router.delete('/social/follows/:id', ExpressHelper.loggedInOnly, this.requireCalendarId, this.unfollowCalendar);
    router.post('/social/shares', ExpressHelper.loggedInOnly, this.requireCalendarId, this.shareEvent);
    router.delete('/social/shares/:id', ExpressHelper.loggedInOnly,this.requireCalendarId, this.unshareEvent);
    app.use(routePrefix, router);
  }

  async requireCalendarId (req: Request, res: Response, next: express.NextFunction) {
    if (typeof req.body.calendarId === 'string') {
      let calendar = await CalendarService.getCalendar(req.body.calendarId);
      if (calendar) {
        req.body.calendar = calendar;
        next();
      }
      else {
        res.status(400).send('Invalid calendar');
      }
    }
    else {
      res.status(400).send('Invalid request');
    }
  }

  // TODO: Catch error if service throws because target does not exist
  async followCalendar(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).send("Not logged in");
      return;
    }

    if (typeof req.body.remoteCalendar === 'string') {
      await this.service.followCalendar(account, req.body.calendar, req.body.remoteCalendar);
      res.status(200).send('Followed');
    }
    else {
      res.status(400).send('Invalid request');
    }
  }

  // TODO: Catch error if service throws because target does not exist
  async unfollowCalendar(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).send("Not logged in");
      return;
    }

    if (typeof req.body.remoteCalendar === 'string') {
      await this.service.unfollowCalendar(account, req.body.calendar, req.body.remoteCalendar);
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
      await this.service.shareEvent(account, req.body.calendar, req.body.eventId);
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

    if (typeof req.body.eventId === 'string') {
      await this.service.unshareEvent(account, req.body.calendar, req.body.eventId);
      res.status(200).send('Unshared');
    }
    else {
      res.status(400).send('Invalid request');
    }
  }
}
