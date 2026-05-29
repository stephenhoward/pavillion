import express, { Request, Response, Application, RequestHandler } from 'express';
import config from 'config';

import ExpressHelper from '@/server/common/helper/express';
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import DeleteActivity from '@/server/activitypub/model/action/delete';
import FollowActivity from '@/server/activitypub/model/action/follow';
import AcceptActivity from '@/server/activitypub/model/action/accept';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import UndoActivity from '@/server/activitypub/model/action/undo';
import ActivityPubInterface from '@/server/activitypub/interface';
import { logError } from '@/server/common/helper/error-logger';
import CalendarInterface from '@/server/calendar/interface';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('activitypub');
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
    router.get('/calendars/:urlname/events/:eventid/note', this.getNote.bind(this));
    router.get('/calendars/:urlname/series', this.getSeriesCollection.bind(this));
    router.get('/calendars/:urlname/series/:seriesid', this.getSeries.bind(this));
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
      logger.info({ resource: req.query.resource }, 'WebFinger resource lookup');
      const parsed = this.service.parseWebFingerResource(req.query.resource);
      logger.info({ parsed }, 'WebFinger parsed');

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

      res.setHeader('Content-Type', 'application/activity+json');
      res.json(eventObject.toActivityPubObject());
    }
    catch (error) {
      logError(error, `Error fetching event ${req.params.eventid}`);
      res.status(500).send('Internal server error');
    }
  }

  /**
   * Get a calendar event rendered as an ActivityStreams Note for Mastodon-class
   * consumers. Mirrors `getEvent`'s posture: unauthenticated, 404 on missing
   * calendar or missing event. The `:eventid` path param is UUID-validated to
   * avoid wasting a DB query (and to satisfy security-playbook path-param
   * validation).
   *
   * @param urlname - calendar URL name
   * @param eventid - event UUID
   * @returns Note object as ActivityPub JSON-LD
   */
  async getNote(req: Request, res: Response): Promise<void> {
    const { urlname, eventid } = req.params;

    if (!ExpressHelper.isValidUUID(eventid)) {
      res.status(400).send('Invalid event id');
      return;
    }

    try {
      const calendar = await this.calendarService.getCalendarByName(urlname);
      if (!calendar) {
        res.status(404).send('Calendar not found');
        return;
      }

      let event;
      try {
        event = await this.calendarService.getEventById(eventid);
      }
      catch (error) {
        if (error instanceof EventNotFoundError) {
          res.status(404).send('Event not found');
          return;
        }
        throw error;
      }
      if (!event) {
        res.status(404).send('Event not found');
        return;
      }

      const { NoteObject } = await import('@/server/activitypub/model/object/note');
      const noteObject = new NoteObject(calendar, event);

      res.setHeader('Content-Type', 'application/activity+json');
      res.json(noteObject.toActivityPubObject());
    }
    catch (error) {
      logError(error, `Error fetching note for event ${req.params.eventid}`);
      res.status(500).send('Internal server error');
    }
  }

  /**
   * Get an OrderedCollection of series AP Objects for a calendar
   *
   * @param urlname - calendar URL name
   * @returns OrderedCollection of series AP Objects as ActivityPub JSON-LD
   */
  async getSeriesCollection(req: Request, res: Response): Promise<void> {
    const { urlname } = req.params;

    try {
      const calendar = await this.calendarService.getCalendarByName(urlname);
      if (!calendar) {
        res.status(404).send('Calendar not found');
        return;
      }

      const seriesList = await this.calendarService.getSeriesForCalendar(calendar.id);
      const { SeriesObject } = await import('@/server/activitypub/model/object/series');

      const items = seriesList.map(series => new SeriesObject(calendar, series).toActivityPubObject());
      const collection = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'OrderedCollection',
        totalItems: items.length,
        orderedItems: items,
      };

      res.setHeader('Content-Type', 'application/activity+json');
      res.json(collection);
    }
    catch (error) {
      logError(error, `Error fetching series collection for ${req.params.urlname}`);
      res.status(500).send('Internal server error');
    }
  }

  /**
   * Get an individual series Object as ActivityPub JSON-LD
   *
   * @param urlname - calendar URL name
   * @param seriesid - series UUID
   * @returns Series AP Object as ActivityPub JSON-LD
   */
  async getSeries(req: Request, res: Response): Promise<void> {
    const { urlname, seriesid } = req.params;

    try {
      const calendar = await this.calendarService.getCalendarByName(urlname);
      if (!calendar) {
        res.status(404).send('Calendar not found');
        return;
      }

      const series = await this.calendarService.getSeries(seriesid, calendar.id);
      if (!series) {
        res.status(404).send('Series not found');
        return;
      }

      const { SeriesObject } = await import('@/server/activitypub/model/object/series');
      const seriesObject = new SeriesObject(calendar, series);

      res.setHeader('Content-Type', 'application/activity+json');
      res.json(seriesObject.toActivityPubObject());
    }
    catch (error) {
      logError(error, `Error fetching series ${req.params.seriesid}`);
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

    logger.info({ activityType: req.body.type, calendarName }, 'Received inbox activity');
    logger.info({ activityBody: req.body }, 'Inbox activity body');

    // Validate actor URI
    const actorUri = req.body.actor;
    const actorValidation = actorUriSchema.safeParse(actorUri);
    if (!actorValidation.success) {
      logger.error({ issues: actorValidation.error.issues }, 'Invalid actor URI');
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
      logger.error({ activityType: req.body.type, issues: activityValidation.error.issues }, 'Invalid activity');
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
        logError(error, 'Error processing Person actor activity');
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
      case 'Accept':
        message = AcceptActivity.fromObject(req.body);
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
   * Read the outbox of a calendar as a paginated OrderedCollection.
   *
   * Without a `page` query param, returns an OrderedCollection summary
   * with totalItems and a link to the first page.
   * With `page=true`, returns an OrderedCollectionPage with activity items.
   * Supports cursor-based paging via `max_time` query param (ISO 8601).
   *
   * @param urlname - the URL name of the outbox owner
   * @returns OrderedCollection or OrderedCollectionPage
   * reference: https://www.w3.org/TR/activitypub/#outbox
   */
  async readOutbox(req: Request, res: Response): Promise<void> {
    const { urlname } = req.params;
    const VALID_URLNAME = /^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9_]$/i;

    if (!VALID_URLNAME.test(urlname)) {
      res.status(400).send('Invalid calendar name');
      return;
    }

    try {
      const calendar = await this.calendarService.getCalendarByName(urlname);
      if (!calendar) {
        res.status(404).send('Calendar not found');
        return;
      }

      const domain: string = config.get('domain');
      const outboxUrl = `https://${domain}/calendars/${calendar.urlName}/outbox`;

      // If no page param, return the collection summary
      if (req.query.page !== 'true') {
        const { totalItems } = await this.service.readOutbox(calendar.id);

        res.setHeader('Content-Type', 'application/activity+json');
        res.json({
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'OrderedCollection',
          id: outboxUrl,
          totalItems,
          first: `${outboxUrl}?page=true`,
        });
        return;
      }

      // Parse and validate cursor
      let cursor: Date | undefined;
      if (req.query.max_time && typeof req.query.max_time === 'string') {
        const parsed = new Date(req.query.max_time);
        if (isNaN(parsed.getTime())) {
          res.status(400).send('Invalid cursor: max_time must be a valid ISO 8601 timestamp');
          return;
        }
        cursor = parsed;
      }

      const { items, totalItems } = await this.service.readOutbox(calendar.id, cursor);

      // Build page URL
      const pageId = cursor
        ? `${outboxUrl}?page=true&max_time=${cursor.toISOString()}`
        : `${outboxUrl}?page=true`;

      // Serialize activities from the stored message JSON
      const orderedItems = items.map(item => {
        const message = { ...(item.message as Record<string, any>) };
        // Strip bcc/bto per AP spec
        delete message.bcc;
        delete message.bto;
        return message;
      });

      // Build next link if we have a full page
      const PAGE_SIZE = 20;
      const page: Record<string, any> = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'OrderedCollectionPage',
        id: pageId,
        partOf: outboxUrl,
        totalItems,
        orderedItems,
      };

      if (items.length === PAGE_SIZE) {
        const lastItem = items[items.length - 1];
        const nextCursor = lastItem.message_time.toISOString();
        page.next = `${outboxUrl}?page=true&max_time=${nextCursor}`;
      }

      res.setHeader('Content-Type', 'application/activity+json');
      res.json(page);
    }
    catch (error) {
      logError(error, `Error reading outbox for calendar ${urlname}`);
      res.status(500).send('Internal server error');
    }
  }
}
