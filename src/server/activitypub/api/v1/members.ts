import express, { Request, Response } from 'express';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import EventProxy from '@/server/common/helper/event_proxy';
import ExpressHelper from '@/server/common/helper/express';
import ActivityPubMemberService from '@/server/activitypub/service/members';
import CalendarService from '@/server/calendar/service/calendar';

class ActivityPubMemberRoutes extends EventProxy {
  router: express.Router;
  service: ActivityPubMemberService;

  constructor() {
    super();
    this.router = express.Router();
    this.router.post('/social/follows', ExpressHelper.loggedInOnly, this.requireCalendarId, this.followCalendar);
    this.router.delete('/social/follows/:id', ExpressHelper.loggedInOnly, this.requireCalendarId, this.unfollowCalendar);
    this.router.post('/social/shares', ExpressHelper.loggedInOnly, this.requireCalendarId, this.shareEvent);
    this.router.delete('/social/shares/:id', ExpressHelper.loggedInOnly,this.requireCalendarId, this.unshareEvent);

    this.service = new ActivityPubMemberService();
    this.proxyEvents(this.service,['outboxMessageAdded']);
  }

  registerListeners(source: EventEmitter) {
    this.service.registerListeners(source);
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

export default ActivityPubMemberRoutes;
