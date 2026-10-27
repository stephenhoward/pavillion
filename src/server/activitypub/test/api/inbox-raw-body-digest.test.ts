import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import sinon from 'sinon';
import crypto from 'crypto';
import httpSignature from 'http-signature';

import { Cache } from '@/server/activitypub/helper/cache';
import { INBOX_BODY_MAX_BYTES } from '@/server/activitypub/helper/inbox-body-parser';
import { buildCalendarInboxApp, buildUserInboxApp } from './inbox-test-apps';

/**
 * Router-level proof that both inbox routers capture the request bytes for
 * `verifyHttpSignature`. The middleware's unit tests hand it a `rawBody`
 * directly; only a real POST through `installHandlers` shows that the
 * router's body parser stashes it.
 *
 * Signature verification runs for real except for the RSA check itself
 * (`httpSignature.verifySignature` is stubbed and the key cache primed), so
 * the Digest comparison is the code under test.
 */

const REMOTE_ACTOR = 'https://remote.example/calendars/sender';
const KEY_ID = `${REMOTE_ACTOR}#main-key`;

/**
 * A valid activity serialized the way a non-V8 encoder might: padded
 * whitespace and an escaped non-ASCII character. JSON.stringify of the parsed
 * object yields different bytes, so a digest over these bytes only verifies
 * when the receiver hashes what it received.
 */
function nonCanonicalBody(type: string, object: string): string {
  const body = [
    '{',
    '  "@context": "https://www.w3.org/ns/activitystreams",',
    `  "id": "${REMOTE_ACTOR}/activities/caf\\u00e9-1",`,
    `  "type": "${type}",`,
    `  "actor": "${REMOTE_ACTOR}",`,
    `  "object": "${object}"`,
    '}',
  ].join('\n');
  expect(JSON.stringify(JSON.parse(body)), 'fixture must not be V8-canonical').not.toBe(body);
  return body;
}

function sha256(bytes: string): string {
  return crypto.createHash('sha256').update(bytes).digest('base64');
}

function signatureHeader(): string {
  return `keyId="${KEY_ID}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="c2ln"`;
}

const inboxes = [
  {
    name: 'calendar inbox',
    buildApp: buildCalendarInboxApp,
    path: '/calendars/local/inbox',
    body: () => nonCanonicalBody('Follow', 'https://local.example/calendars/local'),
  },
  {
    name: 'user inbox',
    buildApp: buildUserInboxApp,
    path: '/users/alice/inbox',
    body: () => nonCanonicalBody('Add', 'https://remote.example/users/alice'),
  },
];

describe.each(inboxes)('$name digest verification over received bytes', ({ buildApp, path, body }) => {
  const sandbox = sinon.createSandbox();
  let originalSkipSignatures: string | undefined;

  beforeEach(() => {
    originalSkipSignatures = process.env.SKIP_SIGNATURES;
    delete process.env.SKIP_SIGNATURES;
    sandbox.stub(Cache.prototype, 'get').returns('stub-public-key');
    sandbox.stub(httpSignature, 'verifySignature').returns(true);
  });

  afterEach(() => {
    sandbox.restore();
    if (originalSkipSignatures !== undefined) {
      process.env.SKIP_SIGNATURES = originalSkipSignatures;
    }
  });

  function post(wireBody: string, digest: string) {
    return request(buildApp())
      .post(path)
      .set('Content-Type', 'application/activity+json')
      .set('Date', new Date().toUTCString())
      .set('Digest', digest)
      .set('Signature', signatureHeader())
      .send(wireBody);
  }

  it('accepts a Digest computed over the bytes sent', async () => {
    const wireBody = body();

    const response = await post(wireBody, `SHA-256=${sha256(wireBody)}`);

    expect(response.status).toBe(200);
  });

  it('rejects a Digest that does not match the bytes sent', async () => {
    const wireBody = body();

    const response = await post(wireBody, `SHA-256=${sha256(wireBody.replace('Follow', 'Undo').replace('Add', 'Remove'))}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid digest' });
  });

  it('refuses a body over the inbox size limit with 413', async () => {
    const padding = 'x'.repeat(INBOX_BODY_MAX_BYTES);
    const wireBody = JSON.stringify({ type: 'Follow', actor: REMOTE_ACTOR, padding });

    const response = await post(wireBody, `SHA-256=${sha256(wireBody)}`);

    expect(response.status).toBe(413);
  });
});
