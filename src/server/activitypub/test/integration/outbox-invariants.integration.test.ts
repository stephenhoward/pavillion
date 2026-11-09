/**
 * Outbox delivery invariants.
 *
 * Five invariants a calendar's federation depends on. Each fails on the code
 * this file was written against and is skipped until the change that makes it
 * hold lands; the comment beside each `it.skip` names that change. Un-skipping
 * one is a one-token edit, so every invariant has its own describe and its own
 * fixtures.
 *
 * Rows are written through `addToOutbox` with an event bus nothing listens
 * to, so a row stays exactly as the test leaves it until the test itself
 * processes, drains or reads it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import config from 'config';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Calendar } from '@/common/model/calendar';
import ActivityPubDomain from '@/server/activitypub';
import ActivityPubInterface from '@/server/activitypub/interface';
import ActivityPubService from '@/server/activitypub/service/server';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import ProcessOutboxService from '@/server/activitypub/service/outbox';
import CalendarActorService from '@/server/activitypub/service/calendar_actor';
import { addToOutbox } from '@/server/activitypub/helper/outbox';
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import { ActivityPubActivity } from '@/server/activitypub/model/base';
import {
  ActivityPubInboxMessageEntity,
  ActivityPubOutboxMessageEntity,
  FollowerCalendarEntity,
} from '@/server/activitypub/entity/activitypub';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import HousekeepingInterface from '@/server/housekeeping/interface';
import ModerationInterface from '@/server/moderation/interface';
import EmailInterface from '@/server/email/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { waitFor } from '@/server/common/test/lib/test_polling';

const DOMAIN = config.get<string>('domain');

/** Creates a local calendar row and returns its model. */
async function createLocalCalendar(urlName: string): Promise<Calendar> {
  const calendar = new Calendar(uuidv4(), urlName);
  await CalendarEntity.create({
    id: calendar.id,
    url_name: urlName,
    account_id: uuidv4(),
    languages: 'en',
  });
  await CalendarActorEntity.create({
    id: uuidv4(),
    actor_type: 'local',
    calendar_id: calendar.id,
    actor_uri: calendarActorUri(calendar),
  });
  return calendar;
}

/** The calendar's actor URI, as ActivityPubActor.actorUrl derives it. */
function calendarActorUri(calendar: Calendar): string {
  return `https://${DOMAIN}/calendars/${calendar.urlName}`;
}

/** Adds a remote calendar actor following `calendar`, and returns its actor URI. */
async function addRemoteFollower(calendar: Calendar, actorUri: string): Promise<string> {
  const actor = await CalendarActorEntity.create({
    id: uuidv4(),
    actor_type: 'remote',
    calendar_id: null,
    actor_uri: actorUri,
    inbox_url: `${actorUri}/inbox`,
    remote_domain: new URL(actorUri).hostname,
  });
  await FollowerCalendarEntity.create({
    id: uuidv4(),
    calendar_actor_id: actor.id,
    calendar_id: calendar.id,
  });
  return actorUri;
}

/**
 * A Create(Event) by the calendar's own actor, addressed publicly as
 * handleEventCreated addresses it.
 */
function publicCreate(calendar: Calendar, slug: string): CreateActivity {
  const actor = calendarActorUri(calendar);
  const activity = CreateActivity.fromObject({
    actor,
    object: {
      id: `${actor}/events/${slug}`,
      type: 'Event',
      attributedTo: actor,
    },
  });
  if (!activity) {
    throw new Error('fixture: Create did not parse');
  }
  return activity.addressPublic(`${actor}/followers`);
}

/** An Update(Event) by the calendar's own actor, addressed publicly. */
function publicUpdate(calendar: Calendar, slug: string): UpdateActivity {
  const actor = calendarActorUri(calendar);
  const activity = UpdateActivity.fromObject({
    actor,
    object: {
      id: `${actor}/events/${slug}`,
      type: 'Event',
      attributedTo: actor,
    },
  });
  if (!activity) {
    throw new Error('fixture: Update did not parse');
  }
  return activity.addressPublic(`${actor}/followers`);
}

/** Writes `activity` to the calendar's outbox; nothing delivers it. */
async function writeOutboxRow(calendar: Calendar, activity: ActivityPubActivity): Promise<ActivityPubOutboxMessageEntity> {
  await addToOutbox(new EventEmitter(), calendar, activity);
  const row = await ActivityPubOutboxMessageEntity.findByPk(activity.id);
  if (!row) {
    throw new Error(`fixture: outbox row ${activity.id} was not written`);
  }
  return row;
}

/** Records a delivery outcome on a row, as processOutboxMessage would. */
async function markProcessed(row: ActivityPubOutboxMessageEntity, status: string): Promise<void> {
  await row.update({ processed_time: new Date(), processed_status: status });
}

/** Stubs outbound signing: the fixture calendars hold no key pairs. */
function stubSigning(sandbox: sinon.SinonSandbox): void {
  sandbox.stub(CalendarActorService.prototype, 'signActivity').callsFake(async (actorUri: string) => ({
    keyId: `${actorUri}#main-key`,
    signature: 'mock-signature-base64',
    algorithm: 'rsa-sha256',
    headers: '(request-target) host date digest',
    date: new Date().toUTCString(),
  }));
}

/**
 * Stubs the actor-document fetch: each known actor answers with an inbox on
 * its own host, and `refuse` rejects as an unreachable peer does.
 */
function stubActorFetch(sandbox: sinon.SinonSandbox, actors: string[], refuse: string[] = []): void {
  sandbox.stub(axios, 'get').callsFake(async (url: string) => {
    if (refuse.includes(url)) {
      throw new Error(`connect ECONNREFUSED (${url})`);
    }
    if (actors.includes(url)) {
      return { status: 200, data: { inbox: `${url}/inbox` } } as any;
    }
    throw new Error(`Stubbed: no network in test (unexpected GET: ${url})`);
  });
}

/** The inbox URLs axios.post was called with, in call order. */
function postedInboxes(post: sinon.SinonStub): string[] {
  return post.getCalls().map(call => call.args[0] as string);
}

/** A readOutbox service over a fresh event bus. */
function outboxReader(): ActivityPubService {
  const eventBus = new EventEmitter();
  return new ActivityPubService(eventBus, new CalendarInterface(eventBus), new AccountsInterface());
}

describe('Outbox delivery invariants', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  describe('Invariant 1: delivery continues past a recipient whose actor fetch fails', () => {
    let sandbox: sinon.SinonSandbox;
    let axiosPost: sinon.SinonStub;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      stubSigning(sandbox);
      axiosPost = sandbox.stub(axios, 'post').resolves({ status: 202, data: {} } as any);
    });

    afterEach(() => {
      sandbox.restore();
    });

    // un-skipped by pv-w8sl.2
    // fails today because the rejected actor fetch throws out of the recipient loop, so nobody after it is POSTed.
    it.skip('POSTs to recipients 2 and 3 and ends the row partial when the first recipient\'s actor fetch rejects', async () => {
      const calendar = await createLocalCalendar('invariantfanout');
      const unreachable = await addRemoteFollower(calendar, 'https://peer-one.example/calendars/one');
      const second = await addRemoteFollower(calendar, 'https://peer-two.example/calendars/two');
      const third = await addRemoteFollower(calendar, 'https://peer-three.example/calendars/three');
      stubActorFetch(sandbox, [second, third], [unreachable]);

      const create = publicCreate(calendar, 'fanout');
      const row = await writeOutboxRow(calendar, create);

      const eventBus = new EventEmitter();
      const calendarInterface = new CalendarInterface(eventBus);
      const outboxService = new ProcessOutboxService(eventBus, new ProcessInboxService(eventBus, calendarInterface));

      // Precondition: the unreachable peer is the first recipient the
      // delivery loop visits, so the others can only be reached past it.
      const recipients = await outboxService.getRecipients(calendar, create.object);
      expect(recipients, 'fixture: the unreachable recipient must be visited first').toEqual([unreachable, second, third]);

      // A rejection is recorded, not asserted on first: the invariant is about
      // who received the activity, and that is what a failure should report.
      const outcome = await outboxService.processOutboxMessage(row).then(
        () => 'resolved',
        (error: Error) => `rejected: ${error.message}`,
      );

      const posted = postedInboxes(axiosPost);
      expect(posted, 'recipients after the unreachable one must still be POSTed').toEqual(
        expect.arrayContaining([`${second}/inbox`, `${third}/inbox`]),
      );
      expect(posted).toHaveLength(2);
      expect(outcome).toBe('resolved');

      const stored = await ActivityPubOutboxMessageEntity.findByPk(row.id);
      expect(stored!.processed_time).not.toBeNull();
      expect(stored!.processed_status).toMatch(/^partial: /);
      expect(stored!.processed_status).toContain(unreachable);
    });
  });

  describe('Invariant 2: a public Create is served whatever its delivery outcome', () => {
    // un-skipped by pv-w8sl.4
    // fails today because readOutbox serves only rows whose processed_status is exactly 'ok'.
    it.skip('serves a public Create whose delivery to one recipient failed and counts it in totalItems', async () => {
      const calendar = await createLocalCalendar('invariantpartial');

      const partial = publicCreate(calendar, 'partial');
      // The outcome processOutboxMessage records when one follower's delivery fails.
      await markProcessed(
        await writeOutboxRow(calendar, partial),
        'partial: Failed to deliver to https://peer.example/calendars/gone: timeout of 10000ms exceeded',
      );

      // Neither of these is a published activity: one could not be processed
      // at all, the other has not been processed yet.
      const errored = publicCreate(calendar, 'errored');
      await markProcessed(await writeOutboxRow(calendar, errored), 'error: Failed to parse Create activity');
      const unprocessed = publicCreate(calendar, 'unprocessed');
      await writeOutboxRow(calendar, unprocessed);

      const { items, totalItems } = await outboxReader().readOutbox(calendar.id);
      const ids = items.map(item => item.id);

      expect(ids, 'a partial: Create is still the calendar\'s public activity').toContain(partial.id);
      expect(ids).not.toContain(errored.id);
      expect(ids).not.toContain(unprocessed.id);
      expect(totalItems).toBe(1);
    });
  });

  describe('Invariant 3: the public outbox serves only the calendar\'s own public activities', () => {
    // un-skipped by pv-w8sl.4
    // fails today because readOutbox filters on type and status only, so a user-actor Update anchored on the calendar is served.
    it.skip('does not serve or count a user-actor Update addressed only to a remote calendar and anchored on a local calendar', async () => {
      const calendar = await createLocalCalendar('invariantuseractor');
      const remoteCalendarActor = 'https://peer.example/calendars/theirs';
      const userActor = `https://${DOMAIN}/users/editor`;

      // Controls: the calendar's own public Create and Update are served, so
      // an empty outbox, or one that drops every Update, cannot pass.
      const controlCreate = publicCreate(calendar, 'control');
      await markProcessed(await writeOutboxRow(calendar, controlCreate), 'ok');
      const controlUpdate = publicUpdate(calendar, 'control');
      await markProcessed(await writeOutboxRow(calendar, controlUpdate), 'ok');

      // The shape FederationPublisher.publishEventUpdate writes when a local
      // editor updates an event on a remote calendar: signed by the user actor,
      // addressed only to that remote calendar, anchored on a local calendar.
      const remoteUpdate = UpdateActivity.fromObject({
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Update',
        id: `https://${DOMAIN}/activities/${uuidv4()}`,
        actor: userActor,
        to: [remoteCalendarActor],
        object: {
          type: 'Event',
          id: `https://${DOMAIN}/events/${uuidv4()}`,
          name: 'Remote event edit',
          attributedTo: userActor,
        },
      });
      if (!remoteUpdate) {
        throw new Error('fixture: Update did not parse');
      }
      await markProcessed(await writeOutboxRow(calendar, remoteUpdate), 'ok');

      const { items, totalItems } = await outboxReader().readOutbox(calendar.id);

      expect(
        items.map(item => item.id).sort(),
        'only the calendar\'s own public Create and Update are served',
      ).toEqual([controlCreate.id, controlUpdate.id].sort());
      expect(totalItems).toBe(2);
    });
  });

  describe('Invariant 4: the boot drain delivers outbox rows a restart left behind', () => {
    let sandbox: sinon.SinonSandbox;
    let axiosPost: sinon.SinonStub;
    let stopDrain: (() => void) | undefined;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      stubSigning(sandbox);
      axiosPost = sandbox.stub(axios, 'post').resolves({ status: 202, data: {} } as any);
    });

    afterEach(() => {
      stopDrain?.();
      stopDrain = undefined;
      sandbox.restore();
    });

    /** Wires an ActivityPubDomain as the web process does; the drain is not started. */
    function wireDomain(): ActivityPubDomain {
      const eventBus = new EventEmitter();
      const calendarInterface = new CalendarInterface(eventBus);
      const accountsInterface = new AccountsInterface();
      const moderationInterface = new ModerationInterface(
        eventBus,
        calendarInterface,
        accountsInterface,
        sandbox.createStubInstance(EmailInterface) as unknown as EmailInterface,
        sandbox.createStubInstance(ConfigurationInterface) as unknown as ConfigurationInterface,
        sandbox.createStubInstance(ActivityPubInterface) as unknown as ActivityPubInterface,
      );
      const domain = new ActivityPubDomain(
        eventBus,
        calendarInterface,
        accountsInterface,
        { publishJob: async () => {} } as unknown as HousekeepingInterface,
        moderationInterface,
      );
      domain.installEventHandlers();
      return domain;
    }

    // un-skipped by pv-w8sl.5
    // fails today because only the live outboxMessageAdded emit delivers a row, and no drain exists to pick up one left behind.
    it.skip('delivers an ap_outbox row left with processed_time null before the web process starts', async () => {
      const calendar = await createLocalCalendar('invariantdrain');
      const follower = await addRemoteFollower(calendar, 'https://peer.example/calendars/follower');
      stubActorFetch(sandbox, [follower]);

      // Left over from before the start: its outboxMessageAdded emit went to a
      // process that no longer exists.
      const row = await writeOutboxRow(calendar, publicCreate(calendar, 'stranded'));
      expect(row.processed_time).toBeNull();

      const domain = wireDomain();
      // startOutboxDrain does not exist until the drain lands; the optional
      // call then starts nothing and the wait below reports the missing POST.
      const drainable = domain as ActivityPubDomain & { startOutboxDrain?: () => () => void };
      stopDrain = drainable.startOutboxDrain?.();

      await waitFor(
        async () => postedInboxes(axiosPost).includes(`${follower}/inbox`) || null,
        { label: 'stranded outbox row POSTed to the follower inbox' },
      );
      const delivered = await waitFor(async () => {
        const found = await ActivityPubOutboxMessageEntity.findByPk(row.id);
        return found?.processed_time ? found : null;
      }, { label: `outbox row ${row.id} processed` });
      expect(delivered.processed_status).toBe('ok');
    });
  });

  describe('Invariant 5: local dispatch is idempotent', () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('runs dispatchByType once when the same activity is dispatched to the same local calendar twice', async () => {
      const source = await createLocalCalendar('invariantsource');
      const recipient = await createLocalCalendar('invariantrecipient');

      // An EventObjectEntity for the event, so the Announce resolves locally.
      const sourceActor = calendarActorUri(source);
      const eventApId = `${sourceActor}/events/twice`;
      await EventObjectEntity.create({
        event_id: uuidv4(),
        ap_id: eventApId,
        attributed_to: sourceActor,
      });
      const announce = new AnnounceActivity(sourceActor, eventApId);

      const eventBus = new EventEmitter();
      const inboxService = new ProcessInboxService(eventBus, new CalendarInterface(eventBus));
      const dispatchByType = sandbox.spy(inboxService as unknown as { dispatchByType: () => Promise<void> }, 'dispatchByType');

      await inboxService.handleLocalActivityDispatch(recipient, announce);
      await inboxService.handleLocalActivityDispatch(recipient, announce);

      expect(dispatchByType.callCount, 'a second dispatch of an already-processed activity must not run it again').toBe(1);

      const inboxRows = await ActivityPubInboxMessageEntity.findAll({
        where: { calendar_id: recipient.id, id: announce.id },
      });
      expect(inboxRows).toHaveLength(1);
      expect(inboxRows[0].processed_status).toBe('ok');
    });
  });
});
