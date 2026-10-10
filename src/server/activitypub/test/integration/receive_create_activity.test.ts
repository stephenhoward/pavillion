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
import AccountsInterface from '@/server/accounts/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import { EventEntity, EventContentEntity } from '@/server/calendar/entity/event';
import {
  ActivityPubInboxMessageEntity,
  ActivityPubOutboxMessageEntity,
  SharedEventEntity,
} from '@/server/activitypub/entity/activitypub';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

const findInboxForCalendar = async (calendarName: string, app: express.Application): Promise<string> => {

  const webFingerResponse = await request(app).get(`/.well-known/webfinger?resource=acct:${calendarName}@pavillion.dev`);
  expect(webFingerResponse.status,"webfinger lookup succeeded").toBe(200);

  const profileLink = webFingerResponse.body.links.find( (link: any) => link.rel === 'self' );
  expect(profileLink,"found an inbox url").toBeDefined();

  const profileResponse = await request(app).get(profileLink.href.replace('https://pavillion.dev',''));
  expect(profileResponse.status,"webfinger lookup succeeded").toBe(200);

  return profileResponse.body.inbox.replace('https://pavillion.dev','');
};

describe('ActivityPub Create Activity', async () => {
  let env: TestEnvironment;
  let account: Account;
  let calendar: Calendar;
  let otherCalendar: Calendar;
  let calendarInterface: CalendarInterface;
  const calendarName: string = 'testcalendar';
  const userEmail: string = 'testcalendar@pavillion.dev';
  const userPassword: string = 'testpassword';
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
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    let accountInfo = await accountService._setupAccount(userEmail,userPassword);
    account = accountInfo.account;

    // Create CalendarService instance
    calendar = await calendarInterface.createCalendar(account,calendarName);

    // A second local calendar for a peer to target with a wire calendarId.
    otherCalendar = await calendarInterface.createCalendar(account, 'othercalendar');
  });

  afterEach(() => {
    sandbox.restore();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  it('createEvent: should fail without signature', async () => {
    let remoteEventUrl = 'https://remotedomain.dev/api/v1/events/1';

    const inboxUrl = await findInboxForCalendar(calendarName, env.app);
    const response = await request(env.app)
      .post(inboxUrl)
      .send({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: remoteEventUrl,
        type: 'Create',
        actor: 'testcalendar@remotedomain',
        object: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Event',
          content: {
            en: {
              name: 'Test Event',
              description: 'This is a test event',
            },
          },
        },
      });
    // Local events get their own UUID; the remote IRI is stored as
    // event_source_url, so absence of ingestion is checked on that column.
    const entity = await EventEntity.findOne({ where: { event_source_url: remoteEventUrl } });

    expect(response.status).toBe(400);
    expect(entity).toBe(null);
  });

  it('createEvent: should ingest the remote event and auto-repost it as an Announce', async () => {
    const remoteDomain = 'remotedomain.dev';
    const remoteCalendar = 'testcalendar';
    const remoteActorUri = `https://${remoteDomain}/calendars/${remoteCalendar}`;
    const remoteEventUrl = `https://${remoteDomain}/api/v1/events/1`;
    const activityId = `${remoteEventUrl}/create`;

    // The inbox dispatch gate rejects Create activities from calendar actors
    // with no follow relationship, so follow the remote calendar first — the
    // natural reason to receive its Creates. auto_repost_originals=true also
    // drives the DEC-014 Announce assertions below.
    await createFollowingRelationship(calendar.id, remoteActorUri, true, false);

    const inboxUrl = await findInboxForCalendar(calendarName, env.app);
    const getStub = sandbox.stub(axios, 'get');
    const verifyStub = sandbox.stub(httpSignature, 'verifySignature');
    verifyStub.returns(true);
    env.stubRemoteCalendar(getStub, remoteDomain, remoteCalendar);

    // processCreateEvent verifies ownership by re-fetching the object from
    // its origin and comparing attributedTo with the activity's actor; serve
    // the remote event document from the axios stub.
    getStub.withArgs(remoteEventUrl).resolves({
      status: 200,
      data: {
        id: remoteEventUrl,
        type: 'Event',
        attributedTo: remoteActorUri,
      },
    });

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
          content: {
            en: {
              name: 'Test Event',
              description: 'This is a test event',
            },
          },
        },
      });

    expect(response.status,"api call succeeded").toBe(200);
    expect(response.body.error,"no error in the response").toBeUndefined();

    // The emit happens inside the awaited inbox POST, so poll for the inbox
    // row reaching a terminal processed state before reading resulting state.
    const inboxRow = await waitFor(async () => {
      const row = await ActivityPubInboxMessageEntity.findByPk(activityId);
      return row?.processed_status ? row : null;
    });
    expect(inboxRow.processed_status,"inbox message admitted and processed").toBe('ok');

    // The remote event was ingested as a local event row keyed by a fresh
    // UUID, with the remote IRI recorded as event_source_url.
    const entity = await EventEntity.findOne({ where: { event_source_url: remoteEventUrl } });
    expect(entity,"found the ingested event in the database").not.toBeNull();
    expect(entity!.id,"local event has its own id, not the remote IRI").not.toBe(remoteEventUrl);
    expect(entity!.calendar_id,"remote federated events belong to no local calendar").toBeNull();

    const content = await EventContentEntity.findOne({ where: { event_id: entity!.id, language: 'en' } });
    expect(content,"event content was ingested").not.toBeNull();
    expect(content!.name).toBe('Test Event');
    expect(content!.description).toBe('This is a test event');

    // The AP identity of the event is tracked in EventObjectEntity.
    const apObject = await EventObjectEntity.findOne({ where: { ap_id: remoteEventUrl } });
    expect(apObject,"AP object row links the remote IRI to the local event").not.toBeNull();
    expect(apObject!.event_id).toBe(entity!.id);
    expect(apObject!.attributed_to).toBe(remoteActorUri);

    // auto_repost_originals on the follow relationship triggers an automatic
    // repost, which federates as an Announce carrying the canonical event IRI
    // (DEC-014) — not as a Create.
    const share = await SharedEventEntity.findOne({ where: { event_id: entity!.id, calendar_id: calendar.id } });
    expect(share,"auto-repost recorded a shared event").not.toBeNull();
    expect(share!.auto_posted).toBe(true);

    const announce = await ActivityPubOutboxMessageEntity.findOne({
      where: { calendar_id: calendar.id, type: 'Announce' },
    });
    expect(announce,"repost was queued in the outbox as an Announce").not.toBeNull();
    expect((announce!.message as any).object,"Announce carries the canonical event IRI").toBe(remoteEventUrl);
  });

  it('createEvent: should ignore a calendarId supplied on the inbound event', async () => {
    const remoteDomain = 'remotedomain.dev';
    const remoteCalendar = 'injectcreate';
    const remoteActorUri = `https://${remoteDomain}/calendars/${remoteCalendar}`;
    const remoteEventUrl = `https://${remoteDomain}/api/v1/events/inject-create`;
    const activityId = `${remoteEventUrl}/create`;

    await createFollowingRelationship(calendar.id, remoteActorUri, false, false);

    const inboxUrl = await findInboxForCalendar(calendarName, env.app);
    const getStub = sandbox.stub(axios, 'get');
    sandbox.stub(httpSignature, 'verifySignature').returns(true);
    env.stubRemoteCalendar(getStub, remoteDomain, remoteCalendar);
    getStub.withArgs(remoteEventUrl).resolves({
      status: 200,
      data: { id: remoteEventUrl, type: 'Event', attributedTo: remoteActorUri },
    });

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
          calendarId: otherCalendar.id,
          content: { en: { name: 'Injected Create', description: 'x' } },
        },
      });
    expect(response.status,"api call succeeded").toBe(200);

    const inboxRow = await waitFor(async () => {
      const row = await ActivityPubInboxMessageEntity.findByPk(activityId);
      return row?.processed_status ? row : null;
    });
    expect(inboxRow?.processed_status,"inbox message admitted and processed").toBe('ok');

    const entity = await EventEntity.findOne({ where: { event_source_url: remoteEventUrl } });
    expect(entity,"found the ingested event in the database").not.toBeNull();
    expect(entity!.calendar_id,"wire calendarId is not stored").toBeNull();

    const otherEvents = await calendarInterface.listEvents(otherCalendar);
    expect(otherEvents.find(e => e.id === entity!.id),"event is not listed on the targeted calendar").toBeUndefined();
  });

  it('announce: should ignore a calendarId supplied on the fetched event', async () => {
    const remoteDomain = 'remotedomain.dev';
    const remoteCalendar = 'injectannounce';
    const remoteActorUri = `https://${remoteDomain}/calendars/${remoteCalendar}`;
    const remoteEventUrl = `https://${remoteDomain}/api/v1/events/inject-announce`;
    const activityId = `${remoteActorUri}/activities/announce-inject`;

    await createFollowingRelationship(calendar.id, remoteActorUri, false, false);

    const inboxUrl = await findInboxForCalendar(calendarName, env.app);
    const getStub = sandbox.stub(axios, 'get');
    sandbox.stub(httpSignature, 'verifySignature').returns(true);
    env.stubRemoteCalendar(getStub, remoteDomain, remoteCalendar);
    // processShareEvent fetches the announced object from its origin; serve
    // an Event that claims to belong to another local calendar.
    getStub.withArgs(remoteEventUrl).resolves({
      status: 200,
      data: {
        id: remoteEventUrl,
        type: 'Event',
        attributedTo: remoteActorUri,
        calendarId: otherCalendar.id,
        content: { en: { name: 'Injected Announce', description: 'x' } },
      },
    });

    const response = await env.signedPost(
      inboxUrl,
      env.fakeRemoteAuth(remoteDomain, remoteCalendar),
      {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: activityId,
        type: 'Announce',
        actor: remoteActorUri,
        object: remoteEventUrl,
      });
    expect(response.status,"api call succeeded").toBe(200);

    const inboxRow = await waitFor(async () => {
      const row = await ActivityPubInboxMessageEntity.findByPk(activityId);
      return row?.processed_status ? row : null;
    });
    expect(inboxRow?.processed_status,"inbox message admitted and processed").toBe('ok');

    const entity = await EventEntity.findOne({ where: { event_source_url: remoteEventUrl } });
    expect(entity,"found the ingested event in the database").not.toBeNull();
    expect(entity!.calendar_id,"wire calendarId is not stored").toBeNull();

    const otherEvents = await calendarInterface.listEvents(otherCalendar);
    expect(otherEvents.find(e => e.id === entity!.id),"event is not listed on the targeted calendar").toBeUndefined();
  });
});
