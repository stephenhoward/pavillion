import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
import httpSignature from 'http-signature';

import { Cache } from '@/server/activitypub/helper/cache';
import {
  getActorRateLimitStore,
  resetActorRateLimitStore,
  resetCalendarRateLimitStore,
  resetUserRateLimitStore,
} from '@/server/activitypub/middleware/rate-limit';
import { buildCalendarInboxApp, buildUserInboxApp } from './inbox-test-apps';

/**
 * Router-level proof of where the per-peer limiter sits in both installed
 * inbox chains and what it keys on.
 *
 * The chain under test is `<calendar|user limiter>, verifyHttpSignature,
 * createActorRateLimiter(), <handler>`. Signature verification runs for real
 * except for the RSA check: the key cache is primed and the stubbed check
 * accepts only `signature="c2ln"`, so `signature="forged"` fails as a bad
 * signature would.
 */

const VALID_SIGNATURE = 'c2ln';
const ACTOR_LIMIT = 60; // rateLimit.activitypub.actor.max in config/test.yaml

const inboxes = [
  {
    name: 'calendar inbox',
    buildApp: buildCalendarInboxApp,
    path: '/calendars/local/inbox',
    activity: (actor: string, n: number) => ({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${actor}/activities/follow-${n}`,
      type: 'Follow',
      actor,
      object: 'https://local.example/calendars/local',
    }),
  },
  {
    name: 'user inbox',
    buildApp: buildUserInboxApp,
    path: '/users/alice/inbox',
    activity: (actor: string, n: number) => ({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${actor}/activities/add-${n}`,
      type: 'Add',
      actor,
      object: 'https://local.example/users/alice',
      target: 'https://remote.example/calendars/shared',
    }),
  },
];

function signatureHeader(actor: string, signature: string): string {
  return `keyId="${actor}#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="${signature}"`;
}

describe.each(inboxes)('$name rate limiting relative to signature verification', ({ buildApp, path, activity }) => {
  const sandbox = sinon.createSandbox();
  let originalSkipSignatures: string | undefined;
  let app: express.Application;
  let sequence = 0;

  function resetStores() {
    resetActorRateLimitStore();
    resetCalendarRateLimitStore();
    resetUserRateLimitStore();
  }

  beforeEach(() => {
    originalSkipSignatures = process.env.SKIP_SIGNATURES;
    delete process.env.SKIP_SIGNATURES;
    resetStores();
    sandbox.stub(Cache.prototype, 'get').returns('stub-public-key');
    sandbox.stub(httpSignature, 'verifySignature')
      .callsFake((parsed: any) => parsed.params.signature === VALID_SIGNATURE);
    app = buildApp();
  });

  afterEach(() => {
    sandbox.restore();
    resetStores();
    if (originalSkipSignatures !== undefined) {
      process.env.SKIP_SIGNATURES = originalSkipSignatures;
    }
  });

  function post(actor: string, signature?: string) {
    const req = request(app)
      .post(path)
      .set('Content-Type', 'application/activity+json')
      .set('Date', new Date().toUTCString());
    if (signature) {
      req.set('Signature', signatureHeader(actor, signature));
    }
    sequence++;
    return req.send(JSON.stringify(activity(actor, sequence)));
  }

  it('does not let unsigned or forged requests naming a peer consume that peer\'s budget', async () => {
    const victim = 'https://x.example/users/alice';
    const junk = ACTOR_LIMIT / 2;

    for (let i = 0; i < junk; i++) {
      const response = await post(victim);
      expect(response.status).toBe(400);
    }
    for (let i = 0; i < junk; i++) {
      const response = await post(victim, 'forged');
      expect(response.status).toBe(401);
    }
    expect(getActorRateLimitStore().size).toBe(0);

    const response = await post(victim, VALID_SIGNATURE);

    expect(response.status).toBe(200);
  });

  it('keys the budget on the verified signer origin, not the actor path', async () => {
    for (let i = 1; i <= ACTOR_LIMIT; i++) {
      const response = await post(`https://x.example/users/a${i}`, VALID_SIGNATURE);
      expect(response.status).toBe(200);
    }

    const overLimit = await post('https://x.example/users/a-extra', VALID_SIGNATURE);
    expect(overLimit.status).toBe(429);
    expect(overLimit.body.error).toBe('Too many requests from this actor, please try again later.');

    const otherPeer = await post('https://y.example/users/a1', VALID_SIGNATURE);
    expect(otherPeer.status).toBe(200);
  });
});
