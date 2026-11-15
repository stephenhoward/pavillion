/**
 * Integration test: a successful user-actor inbox delivery answers with JSON.
 *
 * Gancio treats a delivery as failed unless the response Content-Type
 * contains `json`, so an accepted POST must not answer with a plain-text body.
 * Mirrors the calendar inbox test; the status code (200) is unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

import UserActorRoutes from '@/server/activitypub/api/v1/user-actor';

describe('ActivityPub user inbox success response', () => {
  beforeAll(() => {
    // Bypass HTTP signature verification so the request reaches the handler.
    process.env.SKIP_SIGNATURES = 'true';
  });

  afterAll(() => {
    delete process.env.SKIP_SIGNATURES;
  });

  it('answers an accepted delivery with 200 and a JSON body', async () => {
    const userActorService: any = {
      getActorByUsername: async (username: string) => ({
        actorUri: `https://local.example/users/${username}`,
        publicKey: 'stub-public-key',
      }),
      processAddActivity: async () => true,
      processRemoveActivity: async () => true,
    };
    const app = express();
    new UserActorRoutes(userActorService).installHandlers(app, '/');

    const response = await request(app)
      .post('/users/alice/inbox')
      .send({
        type: 'Add',
        actor: 'https://remote.example/calendars/test',
        object: { actor: 'https://local.example/users/alice', role: 'editor' },
        target: 'https://remote.example/calendars/test/editors',
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('json');
    expect(response.body).toEqual({});
  });
});
