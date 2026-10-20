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
import {
  ActivityPubInboxMessageEntity,
  ActivityPubOutboxMessageEntity,
  SharedEventEntity,
} from '@/server/activitypub/entity/activitypub';
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

describe('ActivityPub inbox dispatch when two local calendars follow one remote', () => {
  let env: TestEnvironment;
  let account: Account;
  let calendarInterface: CalendarInterface;
  let firstFollower: Calendar;
  let secondFollower: Calendar;
  const firstFollowerName = 'firstfollower';
  const secondFollowerName = 'secondfollower';
  const userEmail = 'twofollowers@pavillion.dev';
  const userPassword = 'testpassword';
  const sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    // listEvents reads shared-event links through the AP interface.
    calendarInterface.setActivityPubInterface(
      new ActivityPubInterface(eventBus, calendarInterface, new AccountsInterface()),
    );
    const accountService = new AccountService(eventBus, new ConfigurationInterface(), new SetupInterface());

    const accountInfo = await accountService._setupAccount(userEmail, userPassword);
    account = accountInfo.account;
    firstFollower = await calendarInterface.createCalendar(account, firstFollowerName);
    secondFollower = await calendarInterface.createCalendar(account, secondFollowerName);
  });

  afterEach(() => {
    sandbox.restore();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  // Invariant (DEC-013): every local recipient of an activity is dispatched
  // to. The design is one `ap_inbox` row per (recipient calendar, activity).
  //
  // Today the table is keyed on the activity id alone: the second follower's
  // delivery collapses onto the first follower's row (`writeInboxRow`
  // findOrCreate on `id`), and the dispatch listener loads that row by
  // primary key, so the second recipient is never dispatched to — the event
  // reaches one follower and silently skips the other.
  //
  // Un-skip when the ap_inbox composite-key change lands.
  it.skip('delivers one Create(Event) to both local followers of the same remote calendar', async () => {
    const remoteDomain = 'remotedomain.dev';
    const remoteCalendar = 'sharedsource';
    const remoteActorUri = `https://${remoteDomain}/calendars/${remoteCalendar}`;
    const remoteEventUrl = `https://${remoteDomain}/api/v1/events/shared-1`;
    const activityId = `${remoteEventUrl}/create`;

    // The relationship gate admits Creates only from a followed calendar;
    // auto_repost_originals=true on both so each is expected to repost.
    await createFollowingRelationship(firstFollower.id, remoteActorUri, true, false);
    await createFollowingRelationship(secondFollower.id, remoteActorUri, true, false);

    const firstInboxUrl = await findInboxForCalendar(firstFollowerName, env.app);
    const secondInboxUrl = await findInboxForCalendar(secondFollowerName, env.app);
    const getStub = sandbox.stub(axios, 'get');
    sandbox.stub(httpSignature, 'verifySignature').returns(true);
    env.stubRemoteCalendar(getStub, remoteDomain, remoteCalendar);

    // processCreateEvent verifies ownership by re-fetching the object from
    // its origin; serve the remote event document from the axios stub.
    getStub.withArgs(remoteEventUrl).resolves({
      status: 200,
      data: { id: remoteEventUrl, type: 'Event', attributedTo: remoteActorUri },
    });

    const createActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityId,
      type: 'Create',
      actor: remoteActorUri,
      object: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: remoteEventUrl,
        type: 'Event',
        attributedTo: remoteActorUri,
        content: { en: { name: 'Shared Event', description: 'x' } },
      },
    };

    // A peer addresses one activity to each follower's inbox: the same
    // activity id arrives at both local inboxes.
    const auth = env.fakeRemoteAuth(remoteDomain, remoteCalendar);
    const firstResponse = await env.signedPost(firstInboxUrl, auth, createActivity);
    expect(firstResponse.status, 'first follower inbox accepted the delivery').toBe(200);
    const secondResponse = await env.signedPost(secondInboxUrl, auth, createActivity);
    expect(secondResponse.status, 'second follower inbox accepted the delivery').toBe(200);

    // The emit happens inside the awaited inbox POST, so poll for each
    // recipient's row reaching a terminal processed state.
    const firstRow = await waitFor(async () => {
      const row = await ActivityPubInboxMessageEntity.findOne({
        where: { calendar_id: firstFollower.id, id: activityId },
      });
      return row?.processed_status ? row : null;
    });
    expect(firstRow.processed_status, 'first follower processed the activity').toBe('ok');

    const secondRow = await waitFor(async () => {
      const row = await ActivityPubInboxMessageEntity.findOne({
        where: { calendar_id: secondFollower.id, id: activityId },
      });
      return row?.processed_status ? row : null;
    }).catch(() => null);
    expect(secondRow, 'second follower has its own processed ap_inbox row for the activity').not.toBeNull();
    expect(secondRow!.processed_status, 'second follower processed the activity').toBe('ok');

    const entity = await EventEntity.findOne({ where: { event_source_url: remoteEventUrl } });
    expect(entity, 'remote event was ingested once').not.toBeNull();

    for (const follower of [firstFollower, secondFollower]) {
      const label = follower.urlName;

      const share = await SharedEventEntity.findOne({ where: { event_id: entity!.id, calendar_id: follower.id } });
      expect(share, `${label}: auto-repost recorded a shared event`).not.toBeNull();
      expect(share!.auto_posted, `${label}: share was auto-posted`).toBe(true);

      const visible = await calendarInterface.listEvents(follower);
      expect(visible.find(e => e.id === entity!.id), `${label}: event is visible on the calendar`).toBeDefined();

      const announce = await ActivityPubOutboxMessageEntity.findOne({
        where: { calendar_id: follower.id, type: 'Announce' },
      });
      expect(announce, `${label}: repost was queued in the outbox as an Announce`).not.toBeNull();
      expect((announce!.message as any).object, `${label}: Announce carries the canonical event IRI`).toBe(remoteEventUrl);
    }
  });
});
