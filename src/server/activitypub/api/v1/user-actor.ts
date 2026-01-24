import express, { Request, Response, Application, RequestHandler } from 'express';

import UserActorService from '@/server/activitypub/service/user_actor';
import { verifyHttpSignature } from '@/server/activitypub/helper/http_signature';

/**
 * Routes for User (Person) ActivityPub actors
 *
 * Handles Person actor discovery, inbox for editor notifications,
 * and outbox for user activity history.
 */
export default class UserActorRoutes {
  private userActorService: UserActorService;

  constructor(userActorService: UserActorService) {
    this.userActorService = userActorService;
  }

  /**
   * Install route handlers on the Express application
   *
   * @param app - Express application instance
   * @param routePrefix - Base path for routes (typically '/')
   */
  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    // Enable JSON body parsing for ActivityPub endpoints
    router.use(express.json({ type: ['application/json', 'application/activity+json'] }));

    // Public endpoint - Person actor discovery
    router.get('/users/:username', this.getUserActor.bind(this));

    // Secure endpoint - User inbox requires HTTP signature
    router.post('/users/:username/inbox', verifyHttpSignature as RequestHandler, this.postToInbox.bind(this));

    // Outbox endpoint - basic implementation (no auth for now, as it returns empty collection)
    router.get('/users/:username/outbox', this.getUserOutbox.bind(this));

    app.use(routePrefix, router);
  }

  /**
   * GET /users/:username
   *
   * Returns the Person actor document for a user
   *
   * @param req - Express request with username parameter
   * @param res - Express response
   */
  async getUserActor(req: Request, res: Response): Promise<void> {
    const { username } = req.params;

    // Retrieve the user actor
    const actor = await this.userActorService.getActorByUsername(username);

    if (!actor) {
      res.status(404).send('User not found');
      return;
    }

    // Build Person actor JSON-LD response
    const personActor = {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1',
      ],
      type: 'Person',
      id: actor.actorUri,
      name: username,
      preferredUsername: username,
      inbox: `${actor.actorUri}/inbox`,
      outbox: `${actor.actorUri}/outbox`,
      publicKey: {
        id: `${actor.actorUri}#main-key`,
        owner: actor.actorUri,
        publicKeyPem: actor.publicKey,
      },
    };

    res.setHeader('Content-Type', 'application/activity+json');
    res.json(personActor);
  }

  /**
   * POST /users/:username/inbox
   *
   * Receives ActivityPub activities addressed to a user
   * Used for editor notifications (Add/Remove from calendar editors)
   *
   * @param req - Express request with activity in body
   * @param res - Express response
   */
  async postToInbox(req: Request, res: Response): Promise<void> {
    const { username } = req.params;

    // Verify user exists
    const actor = await this.userActorService.getActorByUsername(username);

    if (!actor) {
      res.status(404).send('User not found');
      return;
    }

    console.log(`[USER INBOX] Received activity type: ${req.body.type} for user ${username}`);
    console.log(`[USER INBOX] Activity body:`, JSON.stringify(req.body, null, 2));

    const activity = req.body;

    try {
      switch (activity.type) {
        case 'Add':
          // User is being added as editor to a remote calendar
          await this.userActorService.processAddActivity(username, activity);
          break;

        case 'Remove':
          // User is being removed as editor from a remote calendar
          await this.userActorService.processRemoveActivity(username, activity);
          break;

        default:
          console.log(`[USER INBOX] Unhandled activity type: ${activity.type}`);
      }

      res.status(200).send('Activity processed');
    }
    catch (error) {
      console.error(`[USER INBOX] Error processing activity:`, error);
      res.status(500).send('Error processing activity');
    }
  }

  /**
   * GET /users/:username/outbox
   *
   * Returns the user's activity history (outbox)
   * Basic implementation - returns empty collection for now
   *
   * @param req - Express request with optional page parameter
   * @param res - Express response
   */
  async getUserOutbox(req: Request, res: Response): Promise<void> {
    const { username } = req.params;

    // Verify user exists
    const actor = await this.userActorService.getActorByUsername(username);

    if (!actor) {
      res.status(404).send('User not found');
      return;
    }

    // Build basic OrderedCollection response
    // TODO: Implement pagination and actual activity retrieval
    const outbox = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'OrderedCollection',
      id: `${actor.actorUri}/outbox`,
      totalItems: 0,
      orderedItems: [],
    };

    res.setHeader('Content-Type', 'application/activity+json');
    res.json(outbox);
  }
}
