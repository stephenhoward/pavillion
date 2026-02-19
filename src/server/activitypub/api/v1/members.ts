import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import { ValidationError } from '@/common/exceptions/base';
import ExpressHelper from '@/server/common/helper/express';
import CalendarInterface from '@/server/calendar/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import {
  InvalidRemoteCalendarIdentifierError,
  InvalidRepostPolicySettingsError,
  InvalidSharedEventUrlError,
  FollowRelationshipNotFoundError,
  RemoteCalendarNotFoundError,
  RemoteDomainUnreachableError,
  ActivityPubNotSupportedError,
  RemoteProfileFetchError,
  SelfFollowError,
  AlreadyFollowingError,
} from '@/common/exceptions/activitypub';
import { InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';

export default class ActivityPubMemberRoutes {
  private service: ActivityPubInterface;
  private calendarService: CalendarInterface;

  constructor(internalAPI: ActivityPubInterface, calendarAPI: CalendarInterface) {
    this.service = internalAPI;
    this.calendarService = calendarAPI;
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
        res.status(400).json({
          error: 'Invalid calendar',
          errorName: 'InvalidCalendarError',
        });
      }
    }
    else {
      res.status(400).json({
        error: 'Invalid request: calendarId is required',
        errorName: 'InvalidRequestError',
      });
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
        res.status(400).json({
          error: 'Invalid calendar',
          errorName: 'InvalidCalendarError',
        });
      }
    }
    else {
      res.status(400).json({
        error: 'Invalid request: calendarId is required',
        errorName: 'InvalidRequestError',
      });
    }
  }

  async lookupRemoteCalendar(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Not logged in',
        errorName: 'UnauthenticatedError',
      });
      return;
    }

    const identifier = req.query.identifier as string;

    if (!identifier || typeof identifier !== 'string') {
      res.status(400).json({
        error: 'Missing identifier parameter',
        errorName: 'InvalidRequestError',
      });
      return;
    }

    try {
      const preview = await this.service.lookupRemoteCalendar(identifier);
      res.json(preview);
    }
    catch (error: any) {
      if (error instanceof InvalidRemoteCalendarIdentifierError) {
        res.status(400).json({
          error: error.message,
          errorName: 'InvalidRemoteCalendarIdentifierError',
        });
      }
      else if (error instanceof RemoteCalendarNotFoundError) {
        res.status(404).json({
          error: error.message,
          errorName: 'RemoteCalendarNotFoundError',
        });
      }
      else if (error instanceof RemoteDomainUnreachableError) {
        res.status(502).json({
          error: error.message,
          errorName: 'RemoteDomainUnreachableError',
        });
      }
      else if (error instanceof ActivityPubNotSupportedError) {
        res.status(502).json({
          error: error.message,
          errorName: 'ActivityPubNotSupportedError',
        });
      }
      else if (error instanceof RemoteProfileFetchError) {
        res.status(500).json({
          error: error.message,
          errorName: 'RemoteProfileFetchError',
        });
      }
      else {
        console.error('Unexpected error in lookupRemoteCalendar:', error);
        res.status(500).json({
          error: 'An unexpected error occurred',
          errorName: 'UnknownError',
        });
      }
    }
  }

  async getFollows(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Not logged in',
        errorName: 'UnauthenticatedError',
      });
      return;
    }

    const calendar = (req as any).calendar;

    // Verify user has access to this calendar
    const hasAccess = await this.calendarService.userCanModifyCalendar(account, calendar);

    if (!hasAccess) {
      res.status(403).json({
        error: 'Permission denied',
        errorName: 'InsufficientPermissionsError',
      });
      return;
    }

    const follows = await this.service.getFollowing(calendar);
    res.json(follows.map(follow => follow.toObject()));
  }

  async getFollowers(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Not logged in',
        errorName: 'UnauthenticatedError',
      });
      return;
    }

    const calendar = (req as any).calendar;

    // Verify user has access to this calendar
    const hasAccess = await this.calendarService.userCanModifyCalendar(account, calendar);

    if (!hasAccess) {
      res.status(403).json({
        error: 'Permission denied',
        errorName: 'InsufficientPermissionsError',
      });
      return;
    }

    const followers = await this.service.getFollowers(calendar);
    res.json(followers.map(follower => follower.toObject()));
  }

  async updateFollowPolicy(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Not logged in',
        errorName: 'UnauthenticatedError',
      });
      return;
    }

    const calendar = req.body.calendar;
    const followId = req.params.id;
    const autoRepostOriginals = req.body.autoRepostOriginals ?? false;
    const autoRepostReposts = req.body.autoRepostReposts ?? false;

    try {
      // Validate types - protocol-specific format check
      if (typeof autoRepostOriginals !== 'boolean' || typeof autoRepostReposts !== 'boolean') {
        throw new ValidationError('Invalid repost policy settings: expected boolean values');
      }

      // Verify user has access to this calendar
      const hasAccess = await this.calendarService.userCanModifyCalendar(account, calendar);

      if (!hasAccess) {
        res.status(403).json({
          error: 'Permission denied',
          errorName: 'InsufficientPermissionsError',
        });
        return;
      }

      await this.service.updateFollowPolicy(calendar, followId, autoRepostOriginals, autoRepostReposts);

      // Fetch and return updated relationship
      const follows = await this.service.getFollowing(calendar);
      const updatedFollow = follows.find(f => f.id === followId);

      if (updatedFollow) {
        res.json(updatedFollow.toObject());
      }
      else {
        res.status(404).json({
          error: 'Follow relationship not found',
          errorName: 'FollowRelationshipNotFoundError',
        });
      }
    }
    catch (error: any) {
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof InvalidRepostPolicySettingsError) {
        res.status(400).json({
          error: error.message,
          errorName: 'InvalidRepostPolicySettingsError',
        });
      }
      else if (error instanceof FollowRelationshipNotFoundError) {
        res.status(404).json({
          error: error.message,
          errorName: 'FollowRelationshipNotFoundError',
        });
      }
      else {
        console.error('Unexpected error in updateFollowPolicy:', error);
        res.status(500).json({
          error: 'An unexpected error occurred',
          errorName: 'UnknownError',
        });
      }
    }
  }

  async getFeed(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Not logged in',
        errorName: 'UnauthenticatedError',
      });
      return;
    }

    const calendar = (req as any).calendar;
    const page = req.query.page ? parseInt(req.query.page as string) : 0;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string) : 20;

    // Verify user has access to this calendar
    const hasAccess = await this.calendarService.userCanModifyCalendar(account, calendar);

    if (!hasAccess) {
      res.status(403).json({
        error: 'Permission denied',
        errorName: 'InsufficientPermissionsError',
      });
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
      res.status(500).json({
        error: 'Failed to load feed',
        errorName: 'UnknownError',
        message: error.message,
      });
    }
  }

  async followCalendar(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Not logged in',
        errorName: 'UnauthenticatedError',
      });
      return;
    }

    if (typeof req.body.remoteCalendar === 'string') {
      try {
        const autoRepostOriginals = req.body.autoRepostOriginals ?? false;
        const autoRepostReposts = req.body.autoRepostReposts ?? false;
        await this.service.followCalendar(account, req.body.calendar, req.body.remoteCalendar, autoRepostOriginals, autoRepostReposts);
        res.status(200).send('Followed');
      }
      catch (error: any) {
        if (error instanceof ValidationError) {
          ExpressHelper.sendValidationError(res, error);
        }
        else if (error instanceof InvalidRemoteCalendarIdentifierError) {
          res.status(400).json({
            error: error.message,
            errorName: 'InvalidRemoteCalendarIdentifierError',
          });
        }
        else if (error instanceof InsufficientCalendarPermissionsError) {
          res.status(403).json({
            error: error.message,
            errorName: 'InsufficientCalendarPermissionsError',
          });
        }
        else if (error instanceof SelfFollowError) {
          res.status(400).json({
            error: error.message,
            errorName: 'SelfFollowError',
          });
        }
        else if (error instanceof AlreadyFollowingError) {
          res.status(409).json({
            error: error.message,
            errorName: 'AlreadyFollowingError',
          });
        }
        else if (error instanceof InvalidRepostPolicySettingsError) {
          res.status(400).json({
            error: error.message,
            errorName: 'InvalidRepostPolicySettingsError',
          });
        }
        else if (error instanceof RemoteCalendarNotFoundError) {
          res.status(404).json({
            error: error.message,
            errorName: 'RemoteCalendarNotFoundError',
          });
        }
        else {
          console.error('Unexpected error in followCalendar:', error);
          res.status(500).json({
            error: 'An unexpected error occurred',
            errorName: 'UnknownError',
          });
        }
      }
    }
    else {
      res.status(400).json({
        error: 'Invalid request: remoteCalendar is required',
        errorName: 'InvalidRequestError',
      });
    }
  }

  async unfollowCalendar(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Not logged in',
        errorName: 'UnauthenticatedError',
      });
      return;
    }

    const calendar = req.body.calendar;
    // Decode the URL-encoded follow ID from the path parameter
    const followId = req.params.id ? decodeURIComponent(req.params.id) : undefined;

    // Validate required parameters
    if (!followId || typeof followId !== 'string') {
      res.status(400).json({
        error: 'Invalid follow ID',
        errorName: 'InvalidRequestError',
      });
      return;
    }

    // Verify user has access to this calendar
    const hasAccess = await this.calendarService.userCanModifyCalendar(account, calendar);

    if (!hasAccess) {
      res.status(403).json({
        error: 'Permission denied',
        errorName: 'InsufficientPermissionsError',
      });
      return;
    }

    try {
      await this.service.unfollowCalendarById(account, calendar, followId);
      res.status(200).send('Unfollowed');
    }
    catch (error: any) {
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof FollowRelationshipNotFoundError) {
        res.status(404).json({
          error: error.message,
          errorName: 'FollowRelationshipNotFoundError',
        });
      }
      else if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({
          error: error.message,
          errorName: 'InsufficientCalendarPermissionsError',
        });
      }
      else {
        console.error('Unexpected error in unfollowCalendar:', error);
        res.status(500).json({
          error: 'An unexpected error occurred',
          errorName: 'UnknownError',
        });
      }
    }
  }

  async shareEvent(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Not logged in',
        errorName: 'UnauthenticatedError',
      });
      return;
    }

    if (typeof req.body.eventId === 'string') {
      try {
        const categoryIds: string[] | undefined = Array.isArray(req.body.categoryIds)
          ? req.body.categoryIds
          : undefined;
        await this.service.shareEvent(account, req.body.calendar, req.body.eventId, false, categoryIds);
        res.status(200).send('Shared');
      }
      catch (error: any) {
        if (error instanceof ValidationError) {
          ExpressHelper.sendValidationError(res, error);
        }
        else if (error instanceof InvalidSharedEventUrlError) {
          res.status(400).json({
            error: error.message,
            errorName: 'InvalidSharedEventUrlError',
          });
        }
        else if (error instanceof InsufficientCalendarPermissionsError) {
          res.status(403).json({
            error: error.message,
            errorName: 'InsufficientCalendarPermissionsError',
          });
        }
        else {
          console.error('Unexpected error in shareEvent:', error);
          res.status(500).json({
            error: 'An unexpected error occurred',
            errorName: 'UnknownError',
          });
        }
      }
    }
    else {
      res.status(400).json({
        error: 'Invalid request: eventId is required',
        errorName: 'InvalidRequestError',
      });
    }
  }

  async unshareEvent(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Not logged in',
        errorName: 'UnauthenticatedError',
      });
      return;
    }

    if (typeof req.body.eventId === 'string') {
      try {
        await this.service.unshareEvent(account, req.body.calendar, req.body.eventId);
        res.status(200).send('Unshared');
      }
      catch (error: any) {
        if (error instanceof ValidationError) {
          ExpressHelper.sendValidationError(res, error);
        }
        else if (error instanceof InsufficientCalendarPermissionsError) {
          res.status(403).json({
            error: error.message,
            errorName: 'InsufficientCalendarPermissionsError',
          });
        }
        else {
          console.error('Unexpected error in unshareEvent:', error);
          res.status(500).json({
            error: 'An unexpected error occurred',
            errorName: 'UnknownError',
          });
        }
      }
    }
    else {
      res.status(400).json({
        error: 'Invalid request: eventId is required',
        errorName: 'InvalidRequestError',
      });
    }
  }
}
