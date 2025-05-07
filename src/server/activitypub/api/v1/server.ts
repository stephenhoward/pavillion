import express, { Request, Response } from 'express';

import EventProxy from '@/server/common/helper/event_proxy';
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import DeleteActivity from '@/server/activitypub/model/action/delete';
import FollowActivity from '@/server/activitypub/model/action/follow';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import UndoActivity from '@/server/activitypub/model/action/undo';
import ActivityPubService from '@/server/activitypub/service/server';
import CalendarService from '@/server/calendar/service/calendar';
import { verifyHttpSignature } from '@/server/activitypub/helper/http_signature';

/**
 * Routes for the ActivityPub Server to Server API
 */
class ActivityPubServerRoutes extends EventProxy {
  router: express.Router;
  service: ActivityPubService;

  constructor() {
    super();
    this.router = express.Router();

    // Public endpoints (no signature verification required)
    this.router.get('/.well-known/webfinger', async (req,res) => { await this.lookupUser(req,res); });
    this.router.get('/o/:orgname', async (req,res) => { await this.getUserProfile(req,res); });
    this.router.get('/o/:orgname/outbox', async (req,res) => { this.readOutbox(req,res); });

    // Secure endpoints (require signature verification)
    this.router.post('/o/:orgname/inbox', verifyHttpSignature, async (req,res) => { this.addToInbox(req,res); });

    this.service = new ActivityPubService();
    this.proxyEvents(this.service,['inboxMessageAdded']);
  }

  /** Find calendar profile location by webfinger resource
     * @params resource - acct:orgname@domain
     * @returns a WebFingerResponse record
     * reference: https://www.w3.org/community/reports/socialcg/CG-FINAL-apwf-20240608/#forward-discovery
     */
  async lookupUser(req: Request, res: Response) {
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
  async getUserProfile(req: Request, res: Response) {
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
  async addToInbox(req: Request, res: Response) {
    let calendar = await CalendarService.getCalendarByName(req.params.orgname);

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
  async readOutbox(req: Request, res: Response) {
  }
}

export default ActivityPubServerRoutes;
