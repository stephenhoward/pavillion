import express, { Request, Response, Application, RequestHandler } from 'express';

import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import DeleteActivity from '@/server/activitypub/model/action/delete';
import FollowActivity from '@/server/activitypub/model/action/follow';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import UndoActivity from '@/server/activitypub/model/action/undo';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarInterface from '@/server/calendar/interface';
import { verifyHttpSignature } from '@/server/activitypub/helper/http_signature';
import {
  createActorRateLimiter,
  createCalendarRateLimiter,
} from '@/server/activitypub/middleware/rate-limit';
import {
  actorUriSchema,
  createActivitySchema,
  updateActivitySchema,
  deleteActivitySchema,
  followActivitySchema,
  acceptActivitySchema,
  announceActivitySchema,
  undoActivitySchema,
} from '@/server/activitypub/validation/schemas';

/**
 * Routes for the ActivityPub Server to Server API
 */
export default class ActivityPubServerRoutes {
  private service: ActivityPubInterface;
  private calendarService: CalendarInterface;

  constructor(internalAPI: ActivityPubInterface, calendarAPI: CalendarInterface) {
    this.calendarService = calendarAPI;
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    // Enable JSON body parsing for ActivityPub endpoints
    router.use(express.json({ type: ['application/json', 'application/activity+json'] }));

    // Public endpoints (no signature verification required)
    router.get('/.well-known/webfinger', this.lookupUser.bind(this));

    // Calendar (Group) actor endpoints
    router.get('/calendars/:urlname', this.getCalendarActor.bind(this));
    router.get('/calendars/:urlname/events/:eventid', this.getEvent.bind(this));
    router.get('/calendars/:urlname/outbox', this.readOutbox.bind(this));
    router.post('/calendars/:urlname/inbox',
      createActorRateLimiter(),
      createCalendarRateLimiter(),
      verifyHttpSignature as RequestHandler,
      this.addToInbox.bind(this));

    app.use(routePrefix, router);
  }

  /**
   * Find calendar or user profile location by webfinger resource
   *
   * Supports two handle formats:
   * - @user@domain - Person actor lookup
   * - calendar@domain - Group actor (calendar) lookup
   *
   * @params resource - acct:@user@domain or acct:calendar@domain
   * @returns a WebFingerResponse record
   * reference: https://www.w3.org/community/reports/socialcg/CG-FINAL-apwf-20240608/#forward-discovery
   */
  async lookupUser(req: Request, res: Response): Promise<void> {
    if (typeof req.query.resource === 'string') {
      console.log('[API] WebFinger resource:', req.query.resource);
      const parsed = this.service.parseWebFingerResource(req.query.resource);
      console.log('[API] Parsed:', parsed);

      if (parsed.type === 'unknown' || !parsed.name || !parsed.domain) {
        res.status(400).send('Invalid resource format');
        return;
      }

      const webfingerResponse = await this.service.lookupWebFinger(
        parsed.name,
        parsed.domain,
        parsed.type as 'user' | 'calendar',
      );

      if ( webfingerResponse === null ) {
        res.status(404).send(`${parsed.type === 'user' ? 'User' : 'Calendar'} not found`);
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
   * Get calendar Group actor by URL name (NEW PATTERN)
   *
   * @params urlname - calendar URL name
   * @returns Group actor JSON-LD with editors collection
   * reference: https://www.w3.org/TR/activitypub/#actor-objects
   */
  async getCalendarActor(req: Request, res: Response): Promise<void> {
    const profileResponse = await this.service.lookupUserProfile(req.params.urlname);

    if ( profileResponse === null ) {
      res.status(404).send('Calendar not found');
    }
    else {
      const actor = profileResponse.toObject();

      // Update URLs to use /calendars/ pattern
      const domain = actor.id.split('/')[2];
      const urlname = req.params.urlname;
      actor.id = `https://${domain}/calendars/${urlname}`;
      actor.inbox = `https://${domain}/calendars/${urlname}/inbox`;
      actor.outbox = `https://${domain}/calendars/${urlname}/outbox`;

      // Add editors collection reference (Task 3.5)
      actor.editors = `https://${domain}/calendars/${urlname}/editors`;

      // Update publicKey id to match new actor URI
      actor.publicKey.id = `${actor.id}#main-key`;
      actor.publicKey.owner = actor.id;

      // Add security context for publicKey support (Task 3.5)
      actor['@context'] = [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1',
      ];

      res.setHeader('Content-Type', 'application/activity+json');
      res.json(actor);
    }
  }

  /**
   * Get an event object as ActivityPub JSON
   *
   * @param urlname - calendar URL name
   * @param eventid - event UUID
   * @returns Event object as ActivityPub JSON-LD
   */
  async getEvent(req: Request, res: Response): Promise<void> {
    const { urlname, eventid } = req.params;

    try {
      // Get the calendar to construct the full event URL
      const calendar = await this.calendarService.getCalendarByName(urlname);
      if (!calendar) {
        res.status(404).send('Calendar not found');
        return;
      }

      // Get the event by ID
      const event = await this.calendarService.getEventById(eventid);
      if (!event) {
        res.status(404).send('Event not found');
        return;
      }

      // Convert the event to ActivityPub EventObject format
      const EventObject = (await import('@/server/activitypub/model/object/event')).EventObject;
      const eventObject = new EventObject(calendar, event);

      // EventObject is a plain class - serialize it directly
      res.setHeader('Content-Type', 'application/activity+json');
      res.json(eventObject);
    }
    catch (error) {
      console.error(`[API] Error fetching event ${req.params.eventid}:`, error);
      res.status(500).send('Internal server error');
    }
  }

  /**
   * Add an activity message to a calendar's inbox
   *
   * @param urlname - the URL name of the calendar inbox owner
   * @param req.body - the message to add to the inbox
   * reference: https://www.w3.org/TR/activitypub/#server-to-server-interactions
   */
  async addToInbox(req: Request, res: Response): Promise<void> {
    const calendarName = req.params.urlname;
    let calendar = await this.calendarService.getCalendarByName(calendarName);

    if ( calendar === null ) {
      res.status(404).send('Calendar not found');
      return;
    }

    console.log(`[INBOX] Received activity type: ${req.body.type} for calendar ${calendarName}`);
    console.log(`[INBOX] Activity body:`, JSON.stringify(req.body, null, 2));

    // Validate actor URI
    const actorUri = req.body.actor;
    const actorValidation = actorUriSchema.safeParse(actorUri);
    if (!actorValidation.success) {
      console.error(`[INBOX] Invalid actor URI:`, actorValidation.error.issues);
      res.status(400).json({
        error: 'Invalid actor URI',
        details: actorValidation.error.issues,
        errorName: 'ValidationError',
      });
      return;
    }

    // Validate activity based on type
    let activityValidation;
    switch (req.body.type) {
      case 'Create':
        activityValidation = createActivitySchema.safeParse(req.body);
        break;
      case 'Update':
        activityValidation = updateActivitySchema.safeParse(req.body);
        break;
      case 'Delete':
        activityValidation = deleteActivitySchema.safeParse(req.body);
        break;
      case 'Follow':
        activityValidation = followActivitySchema.safeParse(req.body);
        break;
      case 'Accept':
        activityValidation = acceptActivitySchema.safeParse(req.body);
        break;
      case 'Announce':
        activityValidation = announceActivitySchema.safeParse(req.body);
        break;
      case 'Undo':
        activityValidation = undoActivitySchema.safeParse(req.body);
        break;
      default:
        res.status(400).json({
          error: 'Unsupported activity type',
          details: `Activity type '${req.body.type}' is not supported`,
          errorName: 'ValidationError',
        });
        return;
    }

    if (!activityValidation.success) {
      console.error(`[INBOX] Invalid ${req.body.type} activity:`, activityValidation.error.issues);
      res.status(400).json({
        error: `Invalid ${req.body.type} activity`,
        details: activityValidation.error.issues,
        errorName: 'ValidationError',
      });
      return;
    }

    // Check if this is from a Person actor (for synchronous processing)
    const isPersonActor = actorUri && this.service.isPersonActorUri(actorUri);

    // Person actor Create/Update/Delete activities are processed synchronously
    if (isPersonActor && ['Create', 'Update', 'Delete'].includes(req.body.type)) {
      try {
        let activity;
        switch (req.body.type) {
          case 'Create':
            activity = CreateActivity.fromObject(req.body);
            break;
          case 'Update':
            activity = UpdateActivity.fromObject(req.body);
            break;
          case 'Delete':
            activity = DeleteActivity.fromObject(req.body);
            break;
        }

        if (activity) {
          const result = await this.service.processPersonActorActivity(calendar, activity);
          if (result) {
            res.status(200).json(result.toObject());
          }
          else {
            res.status(200).send('Activity processed');
          }
          return;
        }
      }
      catch (error: any) {
        console.error(`[INBOX] Error processing Person actor activity:`, error);
        if (error.message === 'Actor is not an authorized editor of this calendar') {
          res.status(403).send('Forbidden: Not an authorized editor');
        }
        else {
          res.status(500).send('Error processing activity');
        }
        return;
      }
    }

    // Traditional async processing for calendar actor activities and other types
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
      await this.service.addToInbox(calendar, message);
      res.status(200).send('Message received');
    }
    else {
      res.status(400).send('Invalid message');
    }
  }

  /**
   * Read the outbox of a calendar
   *
   * @param urlname - the URL name of the outbox owner
   * @returns a list of messages in the outbox
   * reference: https://www.w3.org/TR/activitypub/#outbox
   */
  // TODO: paging or other limits to the quantity of messages returned
  async readOutbox(req: Request, res: Response): Promise<void> {
    // Implementation needed
    res.status(501).send('Not implemented');
  }
}
