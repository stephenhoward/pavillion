import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarService from '@/server/calendar/service/calendar';
import ActivityPubInterface from '@/server/activitypub/interface';
import { AutoRepostPolicy } from '@/common/model/follow';

export default class ActivityPubMemberRoutes {
  private service: ActivityPubInterface;
  private calendarService: CalendarService;

  constructor(internalAPI: ActivityPubInterface) {
    this.service = internalAPI;
    this.calendarService = new CalendarService();
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/social/lookup', ExpressHelper.loggedInOnly, this.lookupRemoteCalendar.bind(this));
    router.post('/social/follows', ExpressHelper.loggedInOnly, this.requireCalendarId.bind(this), this.followCalendar.bind(this));
    router.get('/social/follows', ExpressHelper.loggedInOnly, this.requireCalendarIdQuery.bind(this), this.getFollows.bind(this));
    router.patch('/social/follows/:id', ExpressHelper.loggedInOnly, this.requireCalendarId.bind(this), this.updateFollowPolicy.bind(this));
    router.delete('/social/follows/:id', ExpressHelper.loggedInOnly, this.requireCalendarId.bind(this), this.unfollowCalendar.bind(this));
    router.get('/social/followers', ExpressHelper.loggedInOnly, this.requireCalendarIdQuery.bind(this), this.getFollowers.bind(this));
    router.get('/social/feed', ExpressHelper.loggedInOnly, this.requireCalendarIdQuery.bind(this), this.getFeed.bind(this));
    router.post('/social/shares', ExpressHelper.loggedInOnly, this.requireCalendarId.bind(this), this.shareEvent.bind(this));
    router.delete('/social/shares/:id', ExpressHelper.loggedInOnly, this.requireCalendarId.bind(this), this.unshareEvent.bind(this));
    app.use(routePrefix, router);
  }

  async requireCalendarId(req: Request, res: Response, next: express.NextFunction) {
    if (typeof req.body.calendarId === 'string') {
      let calendar = await this.calendarService.getCalendar(req.body.calendarId);
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

  async requireCalendarIdQuery(req: Request, res: Response, next: express.NextFunction) {
    if (typeof req.query.calendarId === 'string') {
      let calendar = await this.calendarService.getCalendar(req.query.calendarId);
      if (calendar) {
        (req as any).calendar = calendar;
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

  async lookupRemoteCalendar(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).send("Not logged in");
      return;
    }

    const identifier = req.query.identifier as string;

    if (!identifier || typeof identifier !== 'string') {
      res.status(400).json({ error: 'Missing identifier parameter' });
      return;
    }

    try {
      const preview = await this.service.lookupRemoteCalendar(identifier);
      res.json(preview);
    }
    catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getFollows(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).send("Not logged in");
      return;
    }

    const calendar = (req as any).calendar;

    // Verify user has access to this calendar
    const hasAccess = await this.calendarService.userCanModifyCalendar(account, calendar);

    if (!hasAccess) {
      res.status(403).send("Permission denied");
      return;
    }

    const follows = await this.service.getFollowing(calendar);
    res.json(follows.map(follow => follow.toObject()));
  }

  async getFollowers(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).send("Not logged in");
      return;
    }

    const calendar = (req as any).calendar;

    // Verify user has access to this calendar
    const hasAccess = await this.calendarService.userCanModifyCalendar(account, calendar);

    if (!hasAccess) {
      res.status(403).send("Permission denied");
      return;
    }

    const followers = await this.service.getFollowers(calendar);
    res.json(followers.map(follower => follower.toObject()));
  }

  async updateFollowPolicy(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).send("Not logged in");
      return;
    }

    const calendar = req.body.calendar;
    const followId = req.params.id;
    const repostPolicy = req.body.repostPolicy;

    // Validate repost policy
    const validPolicies = [AutoRepostPolicy.MANUAL, AutoRepostPolicy.ORIGINAL, AutoRepostPolicy.ALL];
    if (!validPolicies.includes(repostPolicy)) {
      res.status(400).send('Invalid repost policy');
      return;
    }

    // Verify user has access to this calendar
    const hasAccess = await this.calendarService.userCanModifyCalendar(account, calendar);

    if (!hasAccess) {
      res.status(403).send("Permission denied");
      return;
    }

    try {
      await this.service.updateFollowPolicy(calendar, followId, repostPolicy);

      // Fetch and return updated relationship
      const follows = await this.service.getFollowing(calendar);
      const updatedFollow = follows.find(f => f.id === followId);

      if (updatedFollow) {
        res.json(updatedFollow.toObject());
      }
      else {
        res.status(404).send('Follow relationship not found');
      }
    }
    catch (error: any) {
      res.status(400).send(error.message);
    }
  }

  async getFeed(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).send("Not logged in");
      return;
    }

    const calendar = (req as any).calendar;
    const page = req.query.page ? parseInt(req.query.page as string) : 0;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string) : 20;

    // Verify user has access to this calendar
    const hasAccess = await this.calendarService.userCanModifyCalendar(account, calendar);

    if (!hasAccess) {
      res.status(403).send("Permission denied");
      return;
    }

    try {
      const events = await this.service.getFeed(calendar, page, pageSize);

      // Check if there are more events (if we got a full page, assume there might be more)
      const hasMore = events.length === pageSize;

      res.json({
        events,
        hasMore,
      });
    }
    catch (error: any) {
      console.error('Error fetching feed:', error.message);
      res.status(500).json({ error: 'Failed to load feed', message: error.message });
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
      const repostPolicy = req.body.repostPolicy || AutoRepostPolicy.MANUAL;
      await this.service.followCalendar(account, req.body.calendar, req.body.remoteCalendar, repostPolicy);
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
