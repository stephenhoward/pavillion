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

    // Public endpoints (no signature verification required)
    router.get('/.well-known/webfinger', this.lookupUser.bind(this));
    router.get('/o/:orgname', this.getUserProfile.bind(this));
    router.get('/o/:orgname/outbox', this.readOutbox.bind(this));

    // Secure endpoints (require signature verification)
    router.post('/o/:orgname/inbox', verifyHttpSignature as RequestHandler, this.addToInbox.bind(this));

    app.use(routePrefix, router);
  }

  /** Find calendar profile location by webfinger resource
     * @params resource - acct:orgname@domain
     * @returns a WebFingerResponse record
     * reference: https://www.w3.org/community/reports/socialcg/CG-FINAL-apwf-20240608/#forward-discovery
     */
  async lookupUser(req: Request, res: Response): Promise<void> {
    if (typeof req.query.resource === 'string') {
      let { username, domain } = this.service.parseWebFingerResource(req.query.resource);
      let webfingerResponse = await this.service.lookupWebFinger(username, domain);
      if ( webfingerResponse === null ) {
        res.status(404).send('Calendar not found');
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
     * Get orginzation actor record by org name
     * @params orgname - org name for the profile
     * @returns a UserProfileResponse record
     * reference: https://www.w3.org/TR/activitypub/#actor-objects
     */
  async getUserProfile(req: Request, res: Response): Promise<void> {
    // todo: grab proper domain for this
    let profileResponse = await this.service.lookupUserProfile(req.params.orgname);
    if ( profileResponse === null ) {
      res.status(404).send('Calendar not found');
    }
    else {
      res.json(profileResponse.toObject());
    }
  }

  /**
     * Add an activity message to a calendar's inbox
     * @param orgname - the org name of the owner of the inbox
     * @param req.body - the message to add to the inbox
     * reference: https://www.w3.org/TR/activitypub/#server-to-server-interactions
     */
  async addToInbox(req: Request, res: Response): Promise<void> {
    let calendar = await this.calendarService.getCalendarByName(req.params.orgname);

    if ( calendar === null ) {
      res.status(404).send('Calendar not found');
      return;
    }

    // TODO: validate message sender is allowed to send this message
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
     * @param orgname - the org name of the owner of the outbox
     * @returns a list of messages in the outbox
     * reference: https://www.w3.org/TR/activitypub/#outbox
     */
  // TODO: paging or other limits to the quantity of messages returned
  async readOutbox(req: Request, res: Response): Promise<void> {
    // Implementation needed
    res.status(501).send('Not implemented');
  }
}
