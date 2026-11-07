/**
 * Integration tests for an inbound Reject of a Follow we sent: the follow row
 * is removed only when the sender is exactly the followed actor, whether the
 * Follow is embedded or referenced by its id. Any other Reject is recorded
 * without effect.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import {
  ActivityPubInboxMessageEntity,
  FollowingCalendarEntity,
} from '@/server/activitypub/entity/activitypub';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import CalendarInterface from '@/server/calendar/interface';
import { Calendar } from '@/common/model/calendar';
import { setupActivityPubSchema, teardownActivityPubSchema } from '@/server/common/test/helpers/database';

const LOCAL_CALENDAR_ID = uuidv4();
const LOCAL_ACTOR_URI = 'https://test.local/calendars/reject-follow';
const REMOTE_ACTOR_URI = 'https://remote.example/calendars/events';
const FOLLOW_ID = `${LOCAL_ACTOR_URI}/follows/${uuidv4()}`;

describe('Inbound Reject of a Follow (integration)', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let inboxService: ProcessInboxService;
  let remoteActorId: string;
  let otherActorId: string;
  let unfollowed: any[];

  beforeEach(async () => {
    await setupActivityPubSchema();
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    unfollowed = [];
    eventBus.on('activitypub:calendar:unfollowed', (p) => unfollowed.push(p));
    const calendarInterface = new CalendarInterface(eventBus);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);
    sandbox.stub(calendarInterface, 'getCalendar')
      .resolves(new Calendar(LOCAL_CALENDAR_ID, 'reject-follow'));

    await CalendarEntity.create({
      id: LOCAL_CALENDAR_ID,
      url_name: 'reject-follow',
      account_id: uuidv4(),
      languages: 'en',
    });

    remoteActorId = uuidv4();
    otherActorId = uuidv4();
    for (const [id, uri, domain] of [
      [remoteActorId, REMOTE_ACTOR_URI, 'remote.example'],
      [otherActorId, 'https://remote.example/calendars/other', 'remote.example'],
    ]) {
      await CalendarActorEntity.create({
        id,
        actor_type: 'remote',
        actor_uri: uri,
        remote_display_name: null,
        remote_domain: domain,
        calendar_id: null,
        private_key: null,
      });
    }

    await FollowingCalendarEntity.create({
      id: FOLLOW_ID,
      calendar_actor_id: remoteActorId,
      calendar_id: LOCAL_CALENDAR_ID,
      auto_repost_originals: false,
      auto_repost_reposts: false,
    });

    sandbox.stub(console, 'log');
    sandbox.stub(console, 'warn');
    sandbox.stub(console, 'error');
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
  });

  async function deliverReject(actor: string, object: unknown): Promise<ActivityPubInboxMessageEntity> {
    const row = await ActivityPubInboxMessageEntity.create({
      id: `${actor}/rejects/${uuidv4()}`,
      calendar_id: LOCAL_CALENDAR_ID,
      type: 'Reject',
      message_time: new Date(),
      message: { type: 'Reject', actor, object },
      auth_source: 'http_signature',
      auth_origin: new URL(actor).origin,
    });
    await inboxService.processInboxMessage(row);
    await row.reload();
    return row;
  }

  const countFollows = () => FollowingCalendarEntity.count({
    where: { calendar_actor_id: remoteActorId, calendar_id: LOCAL_CALENDAR_ID },
  });

  const embeddedFollow = (target: string) => ({
    id: FOLLOW_ID,
    type: 'Follow',
    actor: LOCAL_ACTOR_URI,
    object: target,
  });

  it('removes the follow for a Reject with the Follow embedded, and emits unfollowed', async () => {
    const row = await deliverReject(REMOTE_ACTOR_URI, embeddedFollow(REMOTE_ACTOR_URI));

    expect(row.processed_status).toBe('ok');
    expect(await countFollows()).toBe(0);
    expect(unfollowed).toEqual([{ calendarId: LOCAL_CALENDAR_ID, sourceActorUri: REMOTE_ACTOR_URI }]);
  });

  it('removes the follow for a Reject referencing the Follow by id', async () => {
    const row = await deliverReject(REMOTE_ACTOR_URI, FOLLOW_ID);

    expect(row.processed_status).toBe('ok');
    expect(await countFollows()).toBe(0);
    expect(unfollowed).toHaveLength(1);
  });

  it('leaves no row behind that would block a re-follow', async () => {
    await deliverReject(REMOTE_ACTOR_URI, FOLLOW_ID);

    // followCalendar refuses a retry only while this guard query finds a row.
    const guard = await FollowingCalendarEntity.findOne({
      where: { calendar_actor_id: remoteActorId, calendar_id: LOCAL_CALENDAR_ID },
    });
    expect(guard).toBeNull();
  });

  it('ignores an embedded Reject from a different actor on the same host', async () => {
    const row = await deliverReject(
      'https://remote.example/calendars/other',
      embeddedFollow(REMOTE_ACTOR_URI),
    );

    expect(row.processed_status).toBe('ok');
    expect(await countFollows()).toBe(1);
    expect(unfollowed).toEqual([]);
  });

  it('ignores an embedded Reject from a different host', async () => {
    await deliverReject('https://evil.example/actor', embeddedFollow(REMOTE_ACTOR_URI));

    expect(await countFollows()).toBe(1);
    expect(unfollowed).toEqual([]);
  });

  it('ignores a by-id Reject from an actor that is not the followed one', async () => {
    await deliverReject('https://remote.example/calendars/other', FOLLOW_ID);

    expect(await countFollows()).toBe(1);
    expect(unfollowed).toEqual([]);
  });

  it('records a Reject of a Flag without error or effect', async () => {
    const row = await deliverReject(REMOTE_ACTOR_URI, {
      id: 'https://test.local/flags/1',
      type: 'Flag',
      actor: LOCAL_ACTOR_URI,
      object: 'https://remote.example/events/1',
    });

    expect(row.processed_status).toBe('ok');
    expect(await countFollows()).toBe(1);
    expect(unfollowed).toEqual([]);
  });

  it('records a Reject of an unknown URI without error or effect', async () => {
    const row = await deliverReject(REMOTE_ACTOR_URI, 'https://test.local/flags/unknown');

    expect(row.processed_status).toBe('ok');
    expect(await countFollows()).toBe(1);
    expect(unfollowed).toEqual([]);
  });
});
