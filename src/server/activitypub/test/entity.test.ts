import { describe, it, expect, assertType, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import DeleteActivity from '@/server/activitypub/model/action/delete';
import FollowActivity from '@/server/activitypub/model/action/follow';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import UndoActivity from '@/server/activitypub/model/action/undo';
import {
  ActivityPubInboxMessageEntity,
  RepostDismissalEntity,
} from '@/server/activitypub/entity/activitypub';
import { EventEntity } from '@/server/calendar/entity/event';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import db from '@/server/common/entity/db';

describe('toModel', () => {
  it('should fail to make a message', async () => {
    let testEntity = ActivityPubInboxMessageEntity.build({
      type: 'NotAValidType',
    });

    expect( () => testEntity.toModel() ).toThrowError('Invalid message type: "NotAValidType"');
  });

  it('should make a create message', async () => {

    let testEntity = ActivityPubInboxMessageEntity.build({
      id: 'testId1',
      type: 'Create',
      message: {
        actor: 'https://example.com/users/1',
        object: { id: 'testObjectId' },
      },
    });

    assertType<CreateActivity>( testEntity.toModel() );
  });

  it('should make an update message', async () => {

    let testEntity = ActivityPubInboxMessageEntity.build({
      id: 'testId1',
      type: 'Update',
      message: {
        actor: 'https://example.com/users/1',
        object: { id: 'testObjectId' },
      },
    });

    assertType<UpdateActivity>( testEntity.toModel() );
  });

  it('should make a delete message', async () => {

    let testEntity = ActivityPubInboxMessageEntity.build({
      id: 'testId1',
      type: 'Delete',
      message: {
        actor: 'https://example.com/users/1',
        object: 'https://example.com/events/1',
      },
    });

    assertType<DeleteActivity>( testEntity.toModel() );
  });

  it('should make a follow message', async () => {

    let testEntity = ActivityPubInboxMessageEntity.build({
      id: 'testId1',
      type: 'Follow',
      message: {
        actor: 'https://example.com/users/1',
        object: 'https://example.com/users/2',
      },
    });

    assertType<FollowActivity>( testEntity.toModel() );
  });

  it('should make an announce message', async () => {

    let testEntity = ActivityPubInboxMessageEntity.build({
      id: 'testId1',
      type: 'Announce',
      message: {
        actor: 'https://example.com/users/1',
        object: 'https://example.com/events/1',
      },
    });

    assertType<AnnounceActivity>( testEntity.toModel() );
  });

  it('should make an undo message', async () => {

    let testEntity = ActivityPubInboxMessageEntity.build({
      id: 'testId1',
      type: 'Undo',
      message: {
        actor: 'https://example.com/users/1',
        object: 'https://example.com/activities/follow/1',
      },
    });

    assertType<UndoActivity>( testEntity.toModel() );
  });
});

describe('RepostDismissalEntity', () => {
  let calendarId: string;
  let eventId: string;

  beforeEach(async () => {
    await db.sync({ force: true });
    // Enable SQLite foreign-key enforcement so ON DELETE CASCADE is honored.
    // (SQLite :memory: defaults to foreign_keys = OFF.)
    await db.query('PRAGMA foreign_keys = ON');

    calendarId = uuidv4();
    await CalendarEntity.create({
      id: calendarId,
      url_name: 'dismissal_cal',
      languages: 'en',
    });

    eventId = uuidv4();
    await EventEntity.create({
      id: eventId,
      calendar_id: calendarId,
    });
  });

  it('allows inserting a dismissal for a valid (event_id, calendar_id) pair', async () => {
    const row = await RepostDismissalEntity.create({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: calendarId,
    });

    expect(row.event_id).toBe(eventId);
    expect(row.calendar_id).toBe(calendarId);
    expect(row.dismissed_at).toBeInstanceOf(Date);
  });

  it('rejects a duplicate (event_id, calendar_id) pair via the unique index', async () => {
    await RepostDismissalEntity.create({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: calendarId,
    });

    await expect(
      RepostDismissalEntity.create({
        id: uuidv4(),
        event_id: eventId,
        calendar_id: calendarId,
      }),
    ).rejects.toThrow();

    const count = await RepostDismissalEntity.count({
      where: { event_id: eventId, calendar_id: calendarId },
    });
    expect(count).toBe(1);
  });

  it('cascades and removes the dismissal row when its event is deleted', async () => {
    await RepostDismissalEntity.create({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: calendarId,
    });

    const before = await RepostDismissalEntity.count({ where: { event_id: eventId } });
    expect(before).toBe(1);

    await EventEntity.destroy({ where: { id: eventId } });

    const after = await RepostDismissalEntity.count({ where: { event_id: eventId } });
    expect(after).toBe(0);
  });
});
