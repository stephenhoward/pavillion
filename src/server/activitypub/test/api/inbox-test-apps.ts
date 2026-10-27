import express from 'express';

import ActivityPubServerRoutes from '@/server/activitypub/api/v1/server';
import UserActorRoutes from '@/server/activitypub/api/v1/user-actor';

/**
 * Express apps that mount the real inbox routers (`installHandlers`, so the
 * real middleware chain) over stubbed services. Router-level tests use them
 * to prove properties of the installed chain rather than of a hand-mounted one.
 */

export function buildCalendarInboxApp(): express.Application {
  const app = express();
  const activityPubInterface: any = {
    isPersonActorUri: () => false,
    addToInbox: async () => undefined,
  };
  const calendarInterface: any = {
    getCalendarByName: async (urlName: string) => ({ id: `calendar-${urlName}`, urlName }),
  };
  new ActivityPubServerRoutes(activityPubInterface, calendarInterface).installHandlers(app, '/');
  return app;
}

export function buildUserInboxApp(): express.Application {
  const app = express();
  const userActorService: any = {
    getActorByUsername: async (username: string) => ({
      actorUri: `https://local.example/users/${username}`,
      publicKey: 'stub-public-key',
    }),
    processAddActivity: async () => true,
    processRemoveActivity: async () => true,
  };
  new UserActorRoutes(userActorService).installHandlers(app, '/');
  return app;
}
