import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import ActivityPubService from '@/server/activitypub/service/members';
import CalendarInterface from '@/server/calendar/interface';
import {
  SharedEventEntity,
  RepostDismissalEntity,
} from '@/server/activitypub/entity/activitypub';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import db from '@/server/common/entity/db';
import {
  setupActivityPubSchema,
  teardownActivityPubSchema,
} from '@/server/test/helpers/database';

/**
 * Sticky-dismissal behavior for memberService.unshareEvent / shareEvent.
 *
 * These tests exercise the real ActivityPub ephemeral schema so we can
 * assert that RepostDismissalEntity rows are written/deleted in the same
 * transaction as the SharedEventEntity mutation.
 *
 * SQLite's `foreign_keys` pragma is disabled here because setupActivityPubSchema()
 * does not sync the full EventEntity graph (LocationEntity, EventSeriesEntity, etc.).
 * We use raw UUIDs for event_id rather than actual EventEntity rows — the
 * service layer only cares that the EventObjectEntity lookup resolves to a UUID
 * that matches SharedEventEntity.event_id and RepostDismissalEntity.event_id.
 */

describe('unshareEvent - RepostDismissalEntity upsert', () => {
  let service: ActivityPubService;
  let sandbox: sinon.SinonSandbox;

  const calendarId = 'c00a0000-0000-4000-8000-000000000001';
  const otherCalendarId = 'c00a0000-0000-4000-8000-000000000002';
  const localEventId = 'e00a0000-0000-4000-8000-000000000001';
  const otherEventId = 'e00a0000-0000-4000-8000-000000000002';
  const eventApUrl = 'https://remote.example.com/events/event-dismissal';

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    await setupActivityPubSchema();
    // Ensure FK enforcement is off — setupActivityPubSchema() does not sync
    // the full EventEntity FK graph (LocationEntity, EventSeriesEntity, etc.).
    await db.query('PRAGMA foreign_keys = OFF');

    const eventBus = new EventEmitter();
    service = new ActivityPubService(eventBus, new CalendarInterface(eventBus));

    // Allow permission checks
    sandbox.stub(service.calendarService, 'userCanModifyCalendar').resolves(true);
    // Stub outbox so we don't try to resolve a real calendar actor record
    sandbox.stub(service, 'addToOutbox').resolves();
    sandbox.stub(service, 'actorUrl').resolves('https://local.example.com/calendars/test-calendar');
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
  });

  it('creates a RepostDismissalEntity row after destroying the SharedEventEntity', async () => {
    // Seed an EventObjectEntity so the AP URL resolves to localEventId
    await EventObjectEntity.create({
      event_id: localEventId,
      ap_id: eventApUrl,
      attributed_to: 'https://remote.example.com/calendars/some-calendar',
    });

    // Seed a SharedEventEntity the service will destroy
    await SharedEventEntity.create({
      id: 'share-activity-uuid-1',
      event_id: localEventId,
      calendar_id: calendarId,
      auto_posted: false,
    });

    const calendar = Calendar.fromObject({ id: calendarId, urlName: 'test-calendar' });
    const account = Account.fromObject({ id: 'test-account-id' });

    await service.unshareEvent(account, calendar, eventApUrl);

    // SharedEventEntity row should be gone
    const remainingShares = await SharedEventEntity.findAll({
      where: { event_id: localEventId, calendar_id: calendarId },
    });
    expect(remainingShares).toHaveLength(0);

    // RepostDismissalEntity row should exist for (event_id, calendar_id)
    const dismissals = await RepostDismissalEntity.findAll({
      where: { event_id: localEventId, calendar_id: calendarId },
    });
    expect(dismissals).toHaveLength(1);
    expect(dismissals[0].event_id).toBe(localEventId);
    expect(dismissals[0].calendar_id).toBe(calendarId);
  });

  it('is idempotent: calling unshareEvent twice does not create duplicate dismissal rows', async () => {
    await EventObjectEntity.create({
      event_id: localEventId,
      ap_id: eventApUrl,
      attributed_to: 'https://remote.example.com/calendars/some-calendar',
    });

    await SharedEventEntity.create({
      id: 'share-activity-uuid-1',
      event_id: localEventId,
      calendar_id: calendarId,
      auto_posted: false,
    });

    const calendar = Calendar.fromObject({ id: calendarId, urlName: 'test-calendar' });
    const account = Account.fromObject({ id: 'test-account-id' });

    // First call destroys the share and writes a dismissal
    await service.unshareEvent(account, calendar, eventApUrl);

    // Second call should NOT throw or duplicate the dismissal
    await expect(
      service.unshareEvent(account, calendar, eventApUrl),
    ).resolves.not.toThrow();

    const dismissals = await RepostDismissalEntity.findAll({
      where: { event_id: localEventId, calendar_id: calendarId },
    });
    expect(dismissals).toHaveLength(1);
  });

  it('does not touch dismissal rows for other (event_id, calendar_id) combinations', async () => {
    await EventObjectEntity.create({
      event_id: localEventId,
      ap_id: eventApUrl,
      attributed_to: 'https://remote.example.com/calendars/some-calendar',
    });

    // Pre-existing dismissal for a different calendar+event
    await RepostDismissalEntity.create({
      event_id: otherEventId,
      calendar_id: otherCalendarId,
    });
    // Pre-existing dismissal for same event but different calendar
    await RepostDismissalEntity.create({
      event_id: localEventId,
      calendar_id: otherCalendarId,
    });

    await SharedEventEntity.create({
      id: 'share-activity-uuid-1',
      event_id: localEventId,
      calendar_id: calendarId,
      auto_posted: false,
    });

    const calendar = Calendar.fromObject({ id: calendarId, urlName: 'test-calendar' });
    const account = Account.fromObject({ id: 'test-account-id' });

    await service.unshareEvent(account, calendar, eventApUrl);

    // All three dismissal rows should now exist: the two pre-existing + the
    // new one for (localEventId, calendarId). None should have been clobbered.
    const all = await RepostDismissalEntity.findAll();
    expect(all).toHaveLength(3);

    const targetDismissal = await RepostDismissalEntity.findOne({
      where: { event_id: localEventId, calendar_id: calendarId },
    });
    expect(targetDismissal).not.toBeNull();
  });
});

describe('shareEvent - RepostDismissalEntity deletion', () => {
  let service: ActivityPubService;
  let sandbox: sinon.SinonSandbox;

  const calendarId = 'c00b0000-0000-4000-8000-000000000001';
  const otherCalendarId = 'c00b0000-0000-4000-8000-000000000002';
  const localEventId = 'e00b0000-0000-4000-8000-000000000001';
  const otherEventId = 'e00b0000-0000-4000-8000-000000000002';
  const eventApUrl = 'https://remote.example.com/events/event-share';

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    await setupActivityPubSchema();
    await db.query('PRAGMA foreign_keys = OFF');

    const eventBus = new EventEmitter();
    service = new ActivityPubService(eventBus, new CalendarInterface(eventBus));

    sandbox.stub(service.calendarService, 'userCanModifyCalendar').resolves(true);
    sandbox.stub(service.calendarService, 'getEventById').resolves(null as any);
    sandbox.stub(service, 'addToOutbox').resolves();
    sandbox.stub(service, 'actorUrl').resolves('https://local.example.com/calendars/test-calendar');
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
  });

  it('deletes any existing dismissal for (event_id, calendar_id) before creating the new share', async () => {
    await EventObjectEntity.create({
      event_id: localEventId,
      ap_id: eventApUrl,
      attributed_to: 'https://remote.example.com/calendars/some-calendar',
    });

    // Pre-existing dismissal — simulates a prior unshareEvent
    await RepostDismissalEntity.create({
      event_id: localEventId,
      calendar_id: calendarId,
    });

    const calendar = Calendar.fromObject({ id: calendarId, urlName: 'test-calendar' });
    const account = Account.fromObject({ id: 'test-account-id' });

    await service.shareEvent(account, calendar, eventApUrl);

    // Dismissal should be gone
    const dismissals = await RepostDismissalEntity.findAll({
      where: { event_id: localEventId, calendar_id: calendarId },
    });
    expect(dismissals).toHaveLength(0);

    // SharedEventEntity should have been created
    const shares = await SharedEventEntity.findAll({
      where: { event_id: localEventId, calendar_id: calendarId },
    });
    expect(shares).toHaveLength(1);
  });

  it('does not touch dismissals for other calendars or other events', async () => {
    await EventObjectEntity.create({
      event_id: localEventId,
      ap_id: eventApUrl,
      attributed_to: 'https://remote.example.com/calendars/some-calendar',
    });

    // Pre-existing dismissals that should NOT be affected by sharing
    // localEventId on calendarId:
    //   - same event, different calendar
    //   - different event, same calendar
    //   - different event, different calendar
    await RepostDismissalEntity.create({ event_id: localEventId, calendar_id: otherCalendarId });
    await RepostDismissalEntity.create({ event_id: otherEventId, calendar_id: calendarId });
    await RepostDismissalEntity.create({ event_id: otherEventId, calendar_id: otherCalendarId });

    const calendar = Calendar.fromObject({ id: calendarId, urlName: 'test-calendar' });
    const account = Account.fromObject({ id: 'test-account-id' });

    await service.shareEvent(account, calendar, eventApUrl);

    // All three pre-existing dismissals should still exist
    const all = await RepostDismissalEntity.findAll();
    expect(all).toHaveLength(3);

    const d1 = await RepostDismissalEntity.findOne({
      where: { event_id: localEventId, calendar_id: otherCalendarId },
    });
    const d2 = await RepostDismissalEntity.findOne({
      where: { event_id: otherEventId, calendar_id: calendarId },
    });
    const d3 = await RepostDismissalEntity.findOne({
      where: { event_id: otherEventId, calendar_id: otherCalendarId },
    });
    expect(d1).not.toBeNull();
    expect(d2).not.toBeNull();
    expect(d3).not.toBeNull();
  });
});
