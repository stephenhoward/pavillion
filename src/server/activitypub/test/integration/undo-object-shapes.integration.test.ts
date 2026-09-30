/**
 * Integration tests for resolving an inbound Undo's target from either
 * shape ActivityPub permits for `object`: a URI string, or the undone
 * activity embedded inline (the shape Mastodon sends). Both must resolve
 * through UndoActivity.targetIdOf, and the stored ap_inbox row — never the
 * embedded copy — must remain the source of truth for what is undone,
 * including the auth_origin cross-check processUnshareEvent performs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import {
  ActivityPubInboxMessageEntity,
  EventActivityEntity,
  FollowerCalendarEntity,
} from '@/server/activitypub/entity/activitypub';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import CalendarInterface from '@/server/calendar/interface';
import { Calendar } from '@/common/model/calendar';
import { setupActivityPubSchema, teardownActivityPubSchema } from '@/server/common/test/helpers/database';

const LOCAL_CALENDAR_ID = uuidv4();
const LOCAL_CALENDAR_URI = 'https://test.local/calendars/undo-shapes';
const REMOTE_ACTOR_URI = 'https://remote.example/users/alice';
const FOLLOW_ID = 'https://remote.example/activities/follow-1';
const ANNOUNCE_ID = 'https://remote.example/activities/announce-1';
const EVENT_AP_ID = 'https://test.local/events/undo-shapes-event';

describe('Inbound Undo object shapes (integration)', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let remoteActorId: string;

  beforeEach(async () => {
    await setupActivityPubSchema();
    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);
    // The AP-only test schema has no calendar_content table, so resolve the
    // receiving calendar without the calendar domain's content join.
    sandbox.stub(calendarInterface, 'getCalendar')
      .resolves(new Calendar(LOCAL_CALENDAR_ID, 'undo-shapes'));

    await CalendarEntity.create({
      id: LOCAL_CALENDAR_ID,
      url_name: 'undo-shapes',
      account_id: uuidv4(),
      languages: 'en',
    });

    remoteActorId = uuidv4();
    await CalendarActorEntity.create({
      id: remoteActorId,
      actor_type: 'remote',
      actor_uri: REMOTE_ACTOR_URI,
      remote_display_name: null,
      remote_domain: 'remote.example',
      calendar_id: null,
      private_key: null,
    });

    sandbox.stub(console, 'log');
    sandbox.stub(console, 'warn');
    sandbox.stub(console, 'error');
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
  });

  const followActivity = {
    id: FOLLOW_ID,
    type: 'Follow',
    actor: REMOTE_ACTOR_URI,
    object: LOCAL_CALENDAR_URI,
  };

  const announceActivity = {
    id: ANNOUNCE_ID,
    type: 'Announce',
    actor: REMOTE_ACTOR_URI,
    object: EVENT_AP_ID,
  };

  async function seedFollow(): Promise<void> {
    await ActivityPubInboxMessageEntity.create({
      id: FOLLOW_ID,
      calendar_id: LOCAL_CALENDAR_ID,
      type: 'Follow',
      message_time: new Date(),
      message: followActivity,
      auth_source: 'http_signature',
      auth_origin: 'https://remote.example',
      processed_status: 'ok',
    });
    await FollowerCalendarEntity.create({
      id: uuidv4(),
      calendar_actor_id: remoteActorId,
      calendar_id: LOCAL_CALENDAR_ID,
    });
  }

  async function seedAnnounce(): Promise<void> {
    await ActivityPubInboxMessageEntity.create({
      id: ANNOUNCE_ID,
      calendar_id: LOCAL_CALENDAR_ID,
      type: 'Announce',
      message_time: new Date(),
      message: announceActivity,
      auth_source: 'http_signature',
      auth_origin: 'https://remote.example',
      processed_status: 'ok',
    });
    await EventActivityEntity.create({
      event_id: EVENT_AP_ID,
      calendar_actor_id: remoteActorId,
      type: 'share',
    });
  }

  async function deliverUndo(actor: string, object: unknown): Promise<ActivityPubInboxMessageEntity> {
    const undoRow = await ActivityPubInboxMessageEntity.create({
      id: `https://remote.example/activities/undo-${uuidv4()}`,
      calendar_id: LOCAL_CALENDAR_ID,
      type: 'Undo',
      message_time: new Date(),
      message: { type: 'Undo', actor, object },
      auth_source: 'http_signature',
      auth_origin: new URL(actor).origin,
    });
    await inboxService.processInboxMessage(undoRow);
    await undoRow.reload();
    return undoRow;
  }

  const countFollowers = () => FollowerCalendarEntity.count({
    where: { calendar_actor_id: remoteActorId, calendar_id: LOCAL_CALENDAR_ID },
  });

  const countShares = () => EventActivityEntity.count({
    where: { event_id: EVENT_AP_ID, calendar_actor_id: remoteActorId, type: 'share' },
  });

  it('removes the follower for an Undo(Follow) with the Follow embedded', async () => {
    await seedFollow();
    expect(await countFollowers()).toBe(1);

    const undoRow = await deliverUndo(REMOTE_ACTOR_URI, followActivity);

    expect(undoRow.processed_status).toBe('ok');
    expect(await countFollowers()).toBe(0);
  });

  it('removes the follower for an Undo(Follow) referencing the Follow by URI', async () => {
    await seedFollow();

    const undoRow = await deliverUndo(REMOTE_ACTOR_URI, FOLLOW_ID);

    expect(undoRow.processed_status).toBe('ok');
    expect(await countFollowers()).toBe(0);
  });

  it('retracts the share for an Undo(Announce) with the Announce embedded', async () => {
    await seedAnnounce();
    expect(await countShares()).toBe(1);

    const undoRow = await deliverUndo(REMOTE_ACTOR_URI, announceActivity);

    expect(undoRow.processed_status).toBe('ok');
    expect(await countShares()).toBe(0);
  });

  it('still enforces the auth_origin cross-check when the Announce is embedded', async () => {
    await seedAnnounce();

    // A third party inlines a copy of alice's Announce, claiming her as its
    // actor. Only the id is taken from the embedded copy; the cross-check
    // compares the stored row's auth_origin against the Undo's own actor.
    const undoRow = await deliverUndo('https://forger.example/users/mallory', announceActivity);

    expect(undoRow.processed_status).toBe('ok');
    expect(await countShares()).toBe(1);
  });

  it('handles an embedded object whose id does not resolve without throwing', async () => {
    await seedFollow();

    const unknown = { ...followActivity, id: 'https://remote.example/activities/never-stored' };
    const undoRow = await deliverUndo(REMOTE_ACTOR_URI, unknown);

    expect(undoRow.processed_status).toBe('error');
    expect(await countFollowers()).toBe(1);
  });

  it('rejects an embedded object carrying no id', async () => {
    await seedFollow();

    const { id: _id, ...noId } = followActivity;
    const undoRow = await deliverUndo(REMOTE_ACTOR_URI, noId);

    expect(undoRow.processed_status).toBe('error');
    expect(await countFollowers()).toBe(1);
  });
});
