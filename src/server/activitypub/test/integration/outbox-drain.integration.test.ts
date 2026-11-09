/**
 * The outbox drain against real rows: what it delivers, what it marks, and
 * that it always terminates.
 *
 * Rows are written through `addToOutbox` with an event bus nothing listens
 * to, so a row stays unprocessed until the drain under test takes it. Every
 * test starts from an empty ap_outbox, because a drain takes every
 * unprocessed row in the table, not only the test's own.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import config from 'config';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Calendar } from '@/common/model/calendar';
import ActivityPubDomain, { OUTBOX_DRAIN_SKIP_NEWER_THAN_MS } from '@/server/activitypub';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import ProcessOutboxService from '@/server/activitypub/service/outbox';
import CalendarActorService from '@/server/activitypub/service/calendar_actor';
import { addToOutbox, PROCESSED_STATUS_MAX_LENGTH } from '@/server/activitypub/helper/outbox';
import CreateActivity from '@/server/activitypub/model/action/create';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import { ActivityPubActivity } from '@/server/activitypub/model/base';
import { ActivityPubOutboxMessageEntity, FollowerCalendarEntity } from '@/server/activitypub/entity/activitypub';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import HousekeepingInterface from '@/server/housekeeping/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { waitFor } from '@/server/common/test/lib/test_polling';

const DOMAIN = config.get<string>('domain');
const FOLLOWER = 'https://peer.example/calendars/follower';

/** The calendar's actor URI, as ActivityPubActor.actorUrl derives it. */
function calendarActorUri(calendar: Calendar): string {
  return `https://${DOMAIN}/calendars/${calendar.urlName}`;
}

/** Creates a local calendar with one remote follower, {@link FOLLOWER}. */
async function createFollowedCalendar(urlName: string): Promise<Calendar> {
  const calendar = new Calendar(uuidv4(), urlName);
  await CalendarEntity.create({ id: calendar.id, url_name: urlName, account_id: uuidv4(), languages: 'en' });
  await CalendarActorEntity.create({
    id: uuidv4(),
    actor_type: 'local',
    calendar_id: calendar.id,
    actor_uri: calendarActorUri(calendar),
  });
  let follower = await CalendarActorEntity.findOne({ where: { actor_uri: FOLLOWER } });
  if (!follower) {
    follower = await CalendarActorEntity.create({
      id: uuidv4(),
      actor_type: 'remote',
      calendar_id: null,
      actor_uri: FOLLOWER,
      inbox_url: `${FOLLOWER}/inbox`,
      remote_domain: new URL(FOLLOWER).hostname,
    });
  }
  await FollowerCalendarEntity.create({ id: uuidv4(), calendar_actor_id: follower.id, calendar_id: calendar.id });
  return calendar;
}

/** A Create(Event) by the calendar's own actor, addressed publicly. */
function publicCreate(calendar: Calendar, slug: string): CreateActivity {
  const actor = calendarActorUri(calendar);
  const activity = CreateActivity.fromObject({
    actor,
    object: { id: `${actor}/events/${slug}`, type: 'Event', attributedTo: actor },
  });
  if (!activity) {
    throw new Error('fixture: Create did not parse');
  }
  return activity.addressPublic(`${actor}/followers`);
}

/** Writes `activity` to the calendar's outbox, `ageMs` old; nothing delivers it. */
async function writeOutboxRow(
  calendar: Calendar,
  activity: ActivityPubActivity,
  ageMs = 0,
): Promise<ActivityPubOutboxMessageEntity> {
  await addToOutbox(new EventEmitter(), calendar, activity);
  if (ageMs > 0) {
    await ActivityPubOutboxMessageEntity.update(
      { message_time: new Date(Date.now() - ageMs) },
      { where: { id: activity.id } },
    );
  }
  const row = await ActivityPubOutboxMessageEntity.findByPk(activity.id);
  if (!row) {
    throw new Error(`fixture: outbox row ${activity.id} was not written`);
  }
  return row;
}

/**
 * Writes a Create row whose message cannot be parsed, so processing it
 * throws. It sorts first: `message_time` an hour before the other rows.
 */
async function writePoisonRow(calendar: Calendar): Promise<ActivityPubOutboxMessageEntity> {
  return ActivityPubOutboxMessageEntity.create({
    id: `${calendarActorUri(calendar)}/events/${uuidv4()}/create`,
    type: 'Create',
    calendar_id: calendar.id,
    message_time: new Date(Date.now() - 3_600_000),
    message: {},
    is_public: false,
  });
}

/** Re-reads a row's stored outcome. */
async function storedRow(id: string): Promise<ActivityPubOutboxMessageEntity> {
  const row = await ActivityPubOutboxMessageEntity.findByPk(id);
  if (!row) {
    throw new Error(`outbox row ${id} is gone`);
  }
  return row;
}

/** The inbox URLs axios.post was called with, in call order. */
function postedInboxes(post: sinon.SinonStub): string[] {
  return post.getCalls().map(call => call.args[0] as string);
}

/** The activity ids axios.post delivered, in call order. */
function postedActivityIds(post: sinon.SinonStub): string[] {
  return post.getCalls().map(call => JSON.parse(call.args[1] as string).id as string);
}

/** An outbox service over a fresh event bus. */
function outboxService(): ProcessOutboxService {
  const eventBus = new EventEmitter();
  return new ProcessOutboxService(eventBus, new ProcessInboxService(eventBus, new CalendarInterface(eventBus)));
}

describe('Outbox drain', () => {
  let env: TestEnvironment;
  let sandbox: sinon.SinonSandbox;
  let axiosPost: sinon.SinonStub;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  beforeEach(async () => {
    await ActivityPubOutboxMessageEntity.destroy({ where: {} });
    sandbox = sinon.createSandbox();
    sandbox.stub(CalendarActorService.prototype, 'signActivity').callsFake(async (actorUri: string) => ({
      keyId: `${actorUri}#main-key`,
      signature: 'mock-signature-base64',
      algorithm: 'rsa-sha256',
      headers: '(request-target) host date digest',
      date: new Date().toUTCString(),
    }));
    sandbox.stub(axios, 'get').callsFake(async (url: string) => {
      if (url === FOLLOWER) {
        return { status: 200, data: { inbox: `${FOLLOWER}/inbox` } } as any;
      }
      throw new Error(`Stubbed: no network in test (unexpected GET: ${url})`);
    });
    axiosPost = sandbox.stub(axios, 'post').resolves({ status: 202, data: {} } as any);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('marks a poison row at the head error: and delivers the two rows behind it', async () => {
    const calendar = await createFollowedCalendar('drainpoison');
    const poison = await writePoisonRow(calendar);
    const first = await writeOutboxRow(calendar, publicCreate(calendar, 'first'));
    const second = await writeOutboxRow(calendar, publicCreate(calendar, 'second'));

    await outboxService().processOutboxMessages();

    expect((await storedRow(poison.id)).processed_status).toBe('error: Failed to parse Create activity');
    expect((await storedRow(poison.id)).processed_time).not.toBeNull();
    expect((await storedRow(first.id)).processed_status).toBe('ok');
    expect((await storedRow(second.id)).processed_status).toBe('ok');
    expect(postedActivityIds(axiosPost).sort()).toEqual([first.id, second.id].sort());
  });

  it('with the skip window, delivers a row older than the window and leaves a newer one', async () => {
    const calendar = await createFollowedCalendar('drainwindow');
    const older = await writeOutboxRow(calendar, publicCreate(calendar, 'older'), OUTBOX_DRAIN_SKIP_NEWER_THAN_MS + 60_000);
    const newer = await writeOutboxRow(calendar, publicCreate(calendar, 'newer'));

    await outboxService().processOutboxMessages({ skipNewerThanMs: OUTBOX_DRAIN_SKIP_NEWER_THAN_MS });

    expect(postedActivityIds(axiosPost)).toEqual([older.id]);
    expect((await storedRow(older.id)).processed_status).toBe('ok');
    expect((await storedRow(newer.id)).processed_time, 'a row inside the window is left to live delivery').toBeNull();
  });

  it('stores an over-long error with control characters bounded and stripped', async () => {
    const calendar = await createFollowedCalendar('drainbounded');
    const row = await writeOutboxRow(calendar, publicCreate(calendar, 'bounded'));
    const service = outboxService();
    sandbox.stub(service, 'processOutboxMessage').rejects(new Error(`peer said\u0000no\r\n${'x'.repeat(400)}`));

    await service.processOutboxMessages();

    const status = (await storedRow(row.id)).processed_status;
    expect(status.startsWith('error: peer said no')).toBe(true);
    expect(status.length).toBeLessThanOrEqual(PROCESSED_STATUS_MAX_LENGTH);
    // eslint-disable-next-line no-control-regex
    expect(status).not.toMatch(/[\u0000-\u001f]/);
  });

  describe('when the error status cannot be written', () => {
    /**
     * Makes `update` on the poison row reject for its first `failures`
     * calls; every other row's update goes through.
     */
    function failPoisonUpdates(poisonId: string, failures: number): sinon.SinonStub {
      const original = ActivityPubOutboxMessageEntity.prototype.update;
      let failed = 0;
      return sandbox.stub(ActivityPubOutboxMessageEntity.prototype, 'update').callsFake(function (this: ActivityPubOutboxMessageEntity, ...args: any[]) {
        if (this.id === poisonId && failed < failures) {
          failed++;
          return Promise.reject(new Error('value refused by the database'));
        }
        return (original as any).apply(this, args);
      });
    }

    it('writes the constant fallback status and carries on', async () => {
      const calendar = await createFollowedCalendar('drainfallback');
      const poison = await writePoisonRow(calendar);
      const good = await writeOutboxRow(calendar, publicCreate(calendar, 'good'));
      failPoisonUpdates(poison.id, 1);

      await outboxService().processOutboxMessages();

      expect((await storedRow(poison.id)).processed_status).toBe('error: processing failed');
      expect((await storedRow(good.id)).processed_status).toBe('ok');
    });

    it('rejects when the fallback fails too, leaving the row for the next drain', async () => {
      const calendar = await createFollowedCalendar('drainunwritable');
      const poison = await writePoisonRow(calendar);
      const good = await writeOutboxRow(calendar, publicCreate(calendar, 'good'));
      const update = failPoisonUpdates(poison.id, 2);
      const service = outboxService();

      await expect(service.processOutboxMessages(), 'the drain ends rather than re-reading the same row').rejects.toThrow('value refused by the database');
      expect(update.callCount, 'one write and one fallback, no loop').toBe(2);
      expect((await storedRow(poison.id)).processed_time).toBeNull();
      expect((await storedRow(good.id)).processed_time, 'the drain stopped at the failing row').toBeNull();

      // The database recovers; the next drain marks the row and delivers the rest.
      await service.processOutboxMessages();
      expect((await storedRow(poison.id)).processed_status).toBe('error: Failed to parse Create activity');
      expect((await storedRow(good.id)).processed_status).toBe('ok');
    });
  });

  it('ends a row error:, not partial:, when its activity id is off our origin for a local recipient', async () => {
    // Local dispatch refuses an activity id off the instance domain. That is a
    // broken invariant of the row, not one recipient's failure, so the row is
    // unserved (error:) rather than served with a delivery note (partial:).
    const source = await createFollowedCalendar('drainorigin');
    const local = await createFollowedCalendar('drainoriginlocal');
    const localActor = await CalendarActorEntity.findOne({ where: { calendar_id: local.id } });
    await FollowerCalendarEntity.create({ id: uuidv4(), calendar_actor_id: localActor!.id, calendar_id: source.id });

    const sourceActor = calendarActorUri(source);
    const eventApId = `${sourceActor}/events/foreign-id`;
    await EventObjectEntity.create({ event_id: uuidv4(), ap_id: eventApId, attributed_to: sourceActor });
    const announce = new AnnounceActivity(sourceActor, eventApId);
    announce.id = `https://foreign.example/activities/${uuidv4()}`;
    const row = await writeOutboxRow(source, announce);

    await outboxService().processOutboxMessages();

    expect((await storedRow(row.id)).processed_status).toMatch(/^error: Local dispatch refused/);
  });

  it('the live handler does not deliver a row the drain processed while it sat queued', async () => {
    const calendar = await createFollowedCalendar('drainlive');
    const create = publicCreate(calendar, 'raced');
    const row = await writeOutboxRow(calendar, create);

    const eventBus = new EventEmitter();
    const domain = new ActivityPubDomain(
      eventBus,
      new CalendarInterface(eventBus),
      new AccountsInterface(),
      { publishJob: async () => {} } as unknown as HousekeepingInterface,
    );
    domain.installEventHandlers();
    // Serialize as SQLite does on every dialect, so the handler is queued
    // behind the drain deterministically.
    (domain as any).eventHandlers.serializeDispatch = true;

    const stopDrain = domain.startOutboxDrain();
    try {
      // The row's own emit, arriving while the boot drain holds the chain.
      eventBus.emit('outboxMessageAdded', create);
      await (domain as any).outboxDrain;
      await waitFor(async () => ((domain as any).eventHandlers.dispatchQueue as Promise<void>).then(() => true), {
        label: 'queued live handler settled',
      });
    }
    finally {
      stopDrain();
    }

    expect(postedInboxes(axiosPost), 'delivered once, by the drain').toEqual([`${FOLLOWER}/inbox`]);
    expect((await storedRow(row.id)).processed_status).toBe('ok');
  });
});
