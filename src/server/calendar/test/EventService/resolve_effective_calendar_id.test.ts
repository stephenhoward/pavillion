import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventRepostEntity } from '@/server/calendar/entity/event_repost';
import EventService from '@/server/calendar/service/events';
import CalendarService from '@/server/calendar/service/calendar';
import type { Transaction } from 'sequelize';

describe('EventService.resolveEffectiveCalendarId', () => {
  let service: EventService;
  let sandbox = sinon.createSandbox();
  let mockAccount: Account;
  let mockTransaction: Transaction;

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    mockAccount = new Account('test-account-id', 'test@example.com');
    mockTransaction = {
      commit: sandbox.stub().resolves(),
      rollback: sandbox.stub().resolves(),
      afterCommit: sandbox.stub(),
      LOCK: {},
    } as unknown as Transaction;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return the original calendar ID when the account owns it', async () => {
    const calendarId = 'owned-calendar-uuid';
    const eventIds = ['11111111-1111-4111-8111-111111111111'];

    sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser')
      .resolves([new Calendar(calendarId, 'my-calendar')]);

    const result = await (service as any).resolveEffectiveCalendarId(
      mockAccount,
      calendarId,
      eventIds,
      mockTransaction,
    );

    expect(result.effectiveCalendarId).toBe(calendarId);
    expect(result.wasRepost).toBe(false);
    expect(result.userCalendars).toHaveLength(1);
    expect(result.userCalendars[0].id).toBe(calendarId);
  });

  it('should return the reposter calendar ID when events are reposts', async () => {
    const originalCalendarId = 'original-calendar-uuid';
    const reposterCalendarId = 'reposter-calendar-uuid';
    const eventIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

    sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser')
      .resolves([new Calendar(reposterCalendarId, 'reposter-calendar')]);

    sandbox.stub(EventRepostEntity, 'findAll').resolves([
      EventRepostEntity.build({ id: 'repost-1', event_id: eventIds[0], calendar_id: reposterCalendarId }),
      EventRepostEntity.build({ id: 'repost-2', event_id: eventIds[1], calendar_id: reposterCalendarId }),
    ]);

    const result = await (service as any).resolveEffectiveCalendarId(
      mockAccount,
      originalCalendarId,
      eventIds,
      mockTransaction,
    );

    expect(result.effectiveCalendarId).toBe(reposterCalendarId);
    expect(result.wasRepost).toBe(true);
    expect(result.userCalendars).toHaveLength(1);
  });

  it('should return the original calendar ID unchanged when the account does not own it and there are no repost records', async () => {
    // The method does not throw — the permission check happens in the caller
    const originalCalendarId = 'original-calendar-uuid';
    const otherCalendarId = 'other-calendar-uuid';
    const eventIds = ['11111111-1111-4111-8111-111111111111'];

    sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser')
      .resolves([new Calendar(otherCalendarId, 'other-calendar')]);

    sandbox.stub(EventRepostEntity, 'findAll').resolves([]);

    const result = await (service as any).resolveEffectiveCalendarId(
      mockAccount,
      originalCalendarId,
      eventIds,
      mockTransaction,
    );

    // Falls through without resolution; caller's permission check will handle the error
    expect(result.effectiveCalendarId).toBe(originalCalendarId);
    expect(result.wasRepost).toBe(false);
  });

  it('should not resolve to repost calendar when reposts span multiple calendars', async () => {
    // If repost records point to different calendars, resolution should not occur
    const originalCalendarId = 'original-calendar-uuid';
    const reposterCalendarId1 = 'reposter-calendar-1';
    const reposterCalendarId2 = 'reposter-calendar-2';
    const eventIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

    sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser')
      .resolves([
        new Calendar(reposterCalendarId1, 'reposter-calendar-1'),
        new Calendar(reposterCalendarId2, 'reposter-calendar-2'),
      ]);

    sandbox.stub(EventRepostEntity, 'findAll').resolves([
      EventRepostEntity.build({ id: 'repost-1', event_id: eventIds[0], calendar_id: reposterCalendarId1 }),
      EventRepostEntity.build({ id: 'repost-2', event_id: eventIds[1], calendar_id: reposterCalendarId2 }),
    ]);

    const result = await (service as any).resolveEffectiveCalendarId(
      mockAccount,
      originalCalendarId,
      eventIds,
      mockTransaction,
    );

    // Mixed repost calendars — no resolution, wasRepost stays false
    expect(result.effectiveCalendarId).toBe(originalCalendarId);
    expect(result.wasRepost).toBe(false);
  });

  it('should not resolve when repost count does not match event count', async () => {
    // If not all events have repost records, resolution should not occur
    const originalCalendarId = 'original-calendar-uuid';
    const reposterCalendarId = 'reposter-calendar-uuid';
    const eventIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

    sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser')
      .resolves([new Calendar(reposterCalendarId, 'reposter-calendar')]);

    // Only one repost record for two events
    sandbox.stub(EventRepostEntity, 'findAll').resolves([
      EventRepostEntity.build({ id: 'repost-1', event_id: eventIds[0], calendar_id: reposterCalendarId }),
    ]);

    const result = await (service as any).resolveEffectiveCalendarId(
      mockAccount,
      originalCalendarId,
      eventIds,
      mockTransaction,
    );

    // Partial repost — no resolution
    expect(result.effectiveCalendarId).toBe(originalCalendarId);
    expect(result.wasRepost).toBe(false);
  });

  it('should return all user calendars in the result for downstream permission checks', async () => {
    const calendarId = 'owned-calendar-uuid';
    const anotherCalendarId = 'another-calendar-uuid';
    const eventIds = ['11111111-1111-4111-8111-111111111111'];

    sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser')
      .resolves([
        new Calendar(calendarId, 'my-calendar'),
        new Calendar(anotherCalendarId, 'another-calendar'),
      ]);

    const result = await (service as any).resolveEffectiveCalendarId(
      mockAccount,
      calendarId,
      eventIds,
      mockTransaction,
    );

    expect(result.userCalendars).toHaveLength(2);
    expect(result.userCalendars.map((c: Calendar) => c.id)).toContain(calendarId);
    expect(result.userCalendars.map((c: Calendar) => c.id)).toContain(anotherCalendarId);
  });
});
