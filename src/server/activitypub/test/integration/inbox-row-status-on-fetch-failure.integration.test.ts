import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import sinon from 'sinon';
import axios from 'axios';
import httpSignature from 'http-signature';
import express from 'express';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { waitFor } from '@/server/common/test/helpers/emit-and-settle';
import { createFollowingRelationship } from '@/server/common/test/helpers/database';
import AccountService from '@/server/accounts/service/account';
import ActivityPubInterface from '@/server/activitypub/interface';
import AccountsInterface from '@/server/accounts/interface';
import { EventEntity } from '@/server/calendar/entity/event';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

const findInboxForCalendar = async (calendarName: string, app: express.Application): Promise<string> => {
  const webFingerResponse = await request(app).get(`/.well-known/webfinger?resource=acct:${calendarName}@pavillion.dev`);
  expect(webFingerResponse.status, 'webfinger lookup succeeded').toBe(200);

  const profileLink = webFingerResponse.body.links.find((link: any) => link.rel === 'self');
  expect(profileLink, 'found an inbox url').toBeDefined();

  const profileResponse = await request(app).get(profileLink.href.replace('https://pavillion.dev', ''));
  expect(profileResponse.status, 'actor document fetched').toBe(200);

  return profileResponse.body.inbox.replace('https://pavillion.dev', '');
};

describe('ActivityPub inbox row status when the object fetch fails', () => {
  let env: TestEnvironment;
  let account: Account;
  let calendar: Calendar;
  const calendarName = 'fetchfailcalendar';
  const userEmail = 'fetchfailcalendar@pavillion.dev';
  const userPassword = 'testpassword';
  const sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    calendarInterface.setActivityPubInterface(
      new ActivityPubInterface(eventBus, calendarInterface, new AccountsInterface()),
    );
    const accountService = new AccountService(eventBus, new ConfigurationInterface(), new SetupInterface());

    const accountInfo = await accountService._setupAccount(userEmail, userPassword);
    account = accountInfo.account;
    calendar = await calendarInterface.createCalendar(account, calendarName);
  });

  afterEach(() => {
    sandbox.restore();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  // Invariant (DEC-013): `ap_inbox` is the log of record for what was
  // accepted. A row is marked `ok` only when its activity was applied.
  //
  // Today a handler that gives up by returning `null` — here, because the
  // object fetch that backs ownership verification fails — is recorded as
  // `ok` by processInboxMessage, while the event is dropped for good. The
  // log then says the activity was applied when it was not.
  //
  // Un-skip when handlers return an outcome (applied / duplicate / refused /
  // retry) and processInboxMessage records that outcome on the row instead
  // of inferring success from "the handler did not throw".
  it.skip('does not mark the ap_inbox row ok when the Create was dropped because the object fetch failed', async () => {
    const remoteDomain = 'remotedomain.dev';
    const remoteCalendar = 'unreachable';
    const remoteActorUri = `https://${remoteDomain}/calendars/${remoteCalendar}`;
    const remoteEventUrl = `https://${remoteDomain}/api/v1/events/unreachable-1`;
    const activityId = `${remoteEventUrl}/create`;

    // The relationship gate admits Creates only from a followed calendar.
    await createFollowingRelationship(calendar.id, remoteActorUri, false, false);

    const inboxUrl = await findInboxForCalendar(calendarName, env.app);
    const getStub = sandbox.stub(axios, 'get');
    sandbox.stub(httpSignature, 'verifySignature').returns(true);
    env.stubRemoteCalendar(getStub, remoteDomain, remoteCalendar);

    // processCreateEvent verifies ownership by re-fetching the object from
    // its origin. Make that fetch fail at the network layer; fetchRemoteObject
    // swallows the error and returns null, actorOwnsObject returns false, and
    // the handler gives up by returning null.
    getStub.withArgs(remoteEventUrl).rejects(new Error('ECONNREFUSED'));

    const response = await env.signedPost(
      inboxUrl,
      env.fakeRemoteAuth(remoteDomain, remoteCalendar),
      {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: activityId,
        type: 'Create',
        actor: remoteActorUri,
        object: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: remoteEventUrl,
          type: 'Event',
          attributedTo: remoteActorUri,
          content: { en: { name: 'Unreachable Event', description: 'x' } },
        },
      });
    expect(response.status, 'inbox accepted the delivery').toBe(200);

    const inboxRow = await waitFor(async () => {
      const row = await ActivityPubInboxMessageEntity.findByPk(activityId);
      return row?.processed_status ? row : null;
    });

    // The event was not applied...
    const entity = await EventEntity.findOne({ where: { event_source_url: remoteEventUrl } });
    expect(entity, 'event was not ingested').toBeNull();

    // ...so the log of record must not say it was.
    expect(inboxRow.processed_status, 'a row is marked ok only when its activity was applied').not.toBe('ok');
  });
});
