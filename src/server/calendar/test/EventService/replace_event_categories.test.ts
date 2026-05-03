import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventEntity } from '@/server/calendar/entity/event';
import { EventCategoryEntity } from '@/server/calendar/entity/event_category';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { EventRepostEntity } from '@/server/calendar/entity/event_repost';
import EventService from '@/server/calendar/service/events';
import CalendarService from '@/server/calendar/service/calendar';
import { EventNotFoundError, InsufficientCalendarPermissionsError, CategoriesNotFoundError } from '@/common/exceptions/calendar';
import { ValidationError } from '@/common/exceptions/base';
import db from '@/server/common/entity/db';
import type { Transaction } from 'sequelize';

/**
 * Builds a stub ActivityPubInterface mirroring the helper in
 * event_service.test.ts. getSharedEventStatusMap drives authoritative
 * repostStatus resolution post-commit.
 */
function buildMockApInterface(
  sharedEventIds: string[] = [],
  statusOverrides: Record<string, 'auto' | 'manual'> = {},
  calendarIdsForEvent: Record<string, string[]> = {},
) {
  const statusMap = new Map<string, 'auto' | 'manual'>();
  for (const id of sharedEventIds) {
    statusMap.set(id, statusOverrides[id] ?? 'manual');
  }
  const getCalendarIdsForSharedEvent = sinon.stub();
  getCalendarIdsForSharedEvent.callsFake(async (eventId: string) => {
    return calendarIdsForEvent[eventId] ?? [];
  });
  return {
    getSharedEventIds: sinon.stub().resolves(sharedEventIds),
    getSharedEventStatusMap: sinon.stub().resolves(statusMap),
    getCalendarIdsForSharedEvent,
  } as any;
}

describe('EventService.replaceEventCategories', () => {
  let service: EventService;
  let sandbox = sinon.createSandbox();
  let mockAccount: Account;

  const validEventId = '11111111-1111-4111-8111-111111111111';
  const validCategoryId1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const validCategoryId2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const calendarId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  function createMockTransaction(): Transaction {
    return {
      commit: sandbox.stub().resolves(),
      rollback: sandbox.stub().resolves(),
      afterCommit: sandbox.stub(),
      LOCK: {},
    } as unknown as Transaction;
  }

  function stubCommonDependencies(options: {
    eventEntity?: any;
    categories?: any[];
    userCalendars?: Calendar[];
    calendar?: Calendar | null;
    repostEntity?: any[];
    mockTransaction?: Transaction;
  } = {}) {
    const mockTransaction = options.mockTransaction ?? createMockTransaction();
    sandbox.stub(db, 'transaction').resolves(mockTransaction);

    if (options.eventEntity !== undefined) {
      sandbox.stub(EventEntity, 'findOne').resolves(options.eventEntity);
    }

    if (options.userCalendars) {
      sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser')
        .resolves(options.userCalendars);
    }

    if (options.calendar !== undefined) {
      sandbox.stub(CalendarService.prototype, 'getCalendar')
        .resolves(options.calendar);
    }

    if (options.categories) {
      sandbox.stub(EventCategoryEntity, 'findAll').resolves(options.categories);
    }

    if (options.repostEntity) {
      sandbox.stub(EventRepostEntity, 'findAll').resolves(options.repostEntity);
    }

    return mockTransaction;
  }

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    // Default AP interface: empty status map. Tests that need a SharedEventEntity
    // signal override this in-test.
    service.setActivityPubInterface(buildMockApInterface());
    mockAccount = new Account('test-account-id', 'test@example.com');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should replace categories on an event successfully', async () => {
    const mockEvent = EventEntity.build({
      id: validEventId,
      calendar_id: calendarId,
      account_id: 'test-account-id',
    });

    const mockCategories = [validCategoryId1, validCategoryId2].map(id =>
      EventCategoryEntity.build({ id, calendar_id: calendarId }),
    );

    const mockTransaction = stubCommonDependencies({
      eventEntity: mockEvent,
      categories: mockCategories,
      userCalendars: [new Calendar(calendarId, 'test-calendar')],
      // Owned event: no repost rows. Authoritative repostStatus = 'none'.
      repostEntity: [],
    });

    const destroyStub = sandbox.stub(EventCategoryAssignmentEntity, 'destroy').resolves(0);
    const bulkCreateStub = sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').resolves([]);

    const returnedEvent = new CalendarEvent(validEventId, calendarId);
    sandbox.stub(service, 'getEventById').resolves(returnedEvent);

    const result = await service.replaceEventCategories(
      mockAccount, validEventId, [validCategoryId1, validCategoryId2],
    );

    expect(result).toBeDefined();
    expect(result.id).toBe(validEventId);
    expect(result.repostStatus).toBe('none');
    expect(destroyStub.calledOnce).toBe(true);
    expect(bulkCreateStub.calledOnce).toBe(true);
    expect((mockTransaction.commit as sinon.SinonStub).calledOnce).toBe(true);
  });

  it('should clear all categories when categoryIds is empty', async () => {
    const mockEvent = EventEntity.build({
      id: validEventId,
      calendar_id: calendarId,
      account_id: 'test-account-id',
    });

    const mockTransaction = stubCommonDependencies({
      eventEntity: mockEvent,
      userCalendars: [new Calendar(calendarId, 'test-calendar')],
      // Owned event: no repost rows for the post-commit lookup.
      repostEntity: [],
    });

    const destroyStub = sandbox.stub(EventCategoryAssignmentEntity, 'destroy').resolves(0);
    const bulkCreateStub = sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').resolves([]);

    const returnedEvent = new CalendarEvent(validEventId, calendarId);
    returnedEvent.categories = [];
    sandbox.stub(service, 'getEventById').resolves(returnedEvent);

    const result = await service.replaceEventCategories(mockAccount, validEventId, []);

    expect(result).toBeDefined();
    expect(result.categories).toEqual([]);
    expect(destroyStub.calledOnce).toBe(true);
    // bulkCreate should NOT be called when categoryIds is empty
    expect(bulkCreateStub.called).toBe(false);
    expect((mockTransaction.commit as sinon.SinonStub).calledOnce).toBe(true);
  });

  it('should throw ValidationError for invalid eventId UUID', async () => {
    await expect(
      service.replaceEventCategories(mockAccount, 'not-a-uuid', [validCategoryId1]),
    ).rejects.toThrow(ValidationError);
  });

  it('should throw ValidationError for invalid categoryId UUID', async () => {
    await expect(
      service.replaceEventCategories(mockAccount, validEventId, ['not-a-uuid']),
    ).rejects.toThrow(ValidationError);
  });

  it('should throw EventNotFoundError when event does not exist', async () => {
    const mockTransaction = stubCommonDependencies({
      eventEntity: null,
    });

    await expect(
      service.replaceEventCategories(mockAccount, validEventId, [validCategoryId1]),
    ).rejects.toThrow(EventNotFoundError);
    expect((mockTransaction.rollback as sinon.SinonStub).calledOnce).toBe(true);
  });

  it('should throw CategoriesNotFoundError when categories do not belong to calendar', async () => {
    const mockEvent = EventEntity.build({
      id: validEventId,
      calendar_id: calendarId,
      account_id: 'test-account-id',
    });

    const mockTransaction = stubCommonDependencies({
      eventEntity: mockEvent,
      categories: [], // No matching categories found
      userCalendars: [new Calendar(calendarId, 'test-calendar')],
    });

    await expect(
      service.replaceEventCategories(mockAccount, validEventId, [validCategoryId1]),
    ).rejects.toThrow(CategoriesNotFoundError);
    expect((mockTransaction.rollback as sinon.SinonStub).calledOnce).toBe(true);
  });

  it('should throw InsufficientCalendarPermissionsError when user lacks permission', async () => {
    const otherCalendarId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const mockEvent = EventEntity.build({
      id: validEventId,
      calendar_id: calendarId,
      account_id: 'other-account-id',
    });

    const mockTransaction = stubCommonDependencies({
      eventEntity: mockEvent,
      userCalendars: [new Calendar(otherCalendarId, 'other-calendar')],
      repostEntity: [], // No repost resolution either
    });

    await expect(
      service.replaceEventCategories(mockAccount, validEventId, [validCategoryId1]),
    ).rejects.toThrow(InsufficientCalendarPermissionsError);
    expect((mockTransaction.rollback as sinon.SinonStub).calledOnce).toBe(true);
  });

  it('should prefer the supplied calendarId over the source calendar when the account owns both', async () => {
    // Regression: when a user owns both the event's source calendar and a repost
    // target calendar, the resolver previously defaulted to the source calendar,
    // which caused category validation to fail for categories belonging to the
    // repost target. Passing calendarId from the client disambiguates.
    const sourceCalendarId = 'source00-0000-4000-8000-000000000001';
    const repostTargetCalendarId = 'repost00-0000-4000-8000-000000000001';

    const mockEvent = EventEntity.build({
      id: validEventId,
      calendar_id: sourceCalendarId,
      account_id: 'test-account-id',
    });

    const repostTargetCategory = EventCategoryEntity.build({
      id: validCategoryId1,
      calendar_id: repostTargetCalendarId,
    });

    const mockTransaction = stubCommonDependencies({
      eventEntity: mockEvent,
      categories: [repostTargetCategory],
      userCalendars: [
        new Calendar(sourceCalendarId, 'source-calendar'),
        new Calendar(repostTargetCalendarId, 'repost-target-calendar'),
      ],
      repostEntity: [
        EventRepostEntity.build({
          id: 'repost-uuid',
          event_id: validEventId,
          calendar_id: repostTargetCalendarId,
        }),
      ],
    });

    sandbox.stub(EventCategoryAssignmentEntity, 'destroy').resolves(0);
    sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').resolves([]);

    const returnedEvent = new CalendarEvent(validEventId, repostTargetCalendarId);
    sandbox.stub(service, 'getEventById').resolves(returnedEvent);

    const result = await service.replaceEventCategories(
      mockAccount, validEventId, [validCategoryId1], repostTargetCalendarId,
    );

    expect(result).toBeDefined();
    // pv-7kxw.1 (option b): repostStatus is now populated authoritatively
    // post-commit. EventRepostEntity has a row matching the acting calendar
    // and SharedEventEntity has no entry, so the legacy fallback resolves
    // to 'manual'.
    expect(result.repostStatus).toBe('manual');
    expect((mockTransaction.commit as sinon.SinonStub).calledOnce).toBe(true);
  });

  it('should resolve repost events to reposter calendar correctly', async () => {
    const originalCalendarId = 'original-0000-4000-8000-000000000001';
    const reposterCalendarId = 'reposter-0000-4000-8000-000000000001';

    const mockEvent = EventEntity.build({
      id: validEventId,
      calendar_id: originalCalendarId,
      account_id: 'other-account-id',
    });

    const mockCategory = EventCategoryEntity.build({
      id: validCategoryId1,
      calendar_id: reposterCalendarId,
    });

    const mockRepost = EventRepostEntity.build({
      id: 'repost-uuid',
      event_id: validEventId,
      calendar_id: reposterCalendarId,
    });

    const mockTransaction = stubCommonDependencies({
      eventEntity: mockEvent,
      categories: [mockCategory],
      userCalendars: [new Calendar(reposterCalendarId, 'reposter-calendar')],
      repostEntity: [mockRepost],
    });

    sandbox.stub(EventCategoryAssignmentEntity, 'destroy').resolves(0);
    sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').resolves([]);

    const returnedEvent = new CalendarEvent(validEventId, reposterCalendarId);
    sandbox.stub(service, 'getEventById').resolves(returnedEvent);

    const result = await service.replaceEventCategories(
      mockAccount, validEventId, [validCategoryId1],
    );

    expect(result).toBeDefined();
    // pv-7kxw.1 (option b): EventRepostEntity has a row on the reposter
    // calendar and SharedEventEntity has no entry, so the legacy fallback
    // resolves repostStatus to 'manual'.
    expect(result.repostStatus).toBe('manual');
    expect(result.isRepost).toBe(true);
    expect((mockTransaction.commit as sinon.SinonStub).calledOnce).toBe(true);
  });

  it('should rollback transaction on error', async () => {
    const mockEvent = EventEntity.build({
      id: validEventId,
      calendar_id: calendarId,
      account_id: 'test-account-id',
    });

    const mockTransaction = stubCommonDependencies({
      eventEntity: mockEvent,
      userCalendars: [new Calendar(calendarId, 'test-calendar')],
    });

    // Destroy throws an error
    sandbox.stub(EventCategoryAssignmentEntity, 'destroy').rejects(new Error('Database error'));

    await expect(
      service.replaceEventCategories(mockAccount, validEventId, []),
    ).rejects.toThrow('Database error');
    expect((mockTransaction.rollback as sinon.SinonStub).calledOnce).toBe(true);
  });

  it('should not set isRepost when event is not a repost', async () => {
    const mockEvent = EventEntity.build({
      id: validEventId,
      calendar_id: calendarId,
      account_id: 'test-account-id',
    });

    stubCommonDependencies({
      eventEntity: mockEvent,
      userCalendars: [new Calendar(calendarId, 'test-calendar')],
      // Owned event: post-commit lookup finds no repost rows.
      repostEntity: [],
    });

    sandbox.stub(EventCategoryAssignmentEntity, 'destroy').resolves(0);

    const returnedEvent = new CalendarEvent(validEventId, calendarId);
    sandbox.stub(service, 'getEventById').resolves(returnedEvent);

    const result = await service.replaceEventCategories(mockAccount, validEventId, []);

    // pv-7kxw.1 (option b): repostStatus is populated authoritatively from
    // SharedEventEntity + EventRepostEntity. Owned events resolve to 'none'.
    expect(result.repostStatus).toBe('none');
    expect(result.isRepost).toBe(false);
  });

  it('should set repostStatus="auto" when SharedEventEntity reports auto_posted (pv-7kxw.1)', async () => {
    // pv-7kxw.1 (option b): SharedEventEntity takes precedence over the
    // EventRepostEntity legacy fallback. An auto-posted share must surface
    // as 'auto' on the return shape.
    const originalCalendarId = 'original-0000-4000-8000-000000000001';
    const reposterCalendarId = 'reposter-0000-4000-8000-000000000001';

    service.setActivityPubInterface(
      buildMockApInterface([validEventId], { [validEventId]: 'auto' }),
    );

    const mockEvent = EventEntity.build({
      id: validEventId,
      calendar_id: originalCalendarId,
      account_id: 'other-account-id',
    });

    const mockCategory = EventCategoryEntity.build({
      id: validCategoryId1,
      calendar_id: reposterCalendarId,
    });

    const mockRepost = EventRepostEntity.build({
      id: 'repost-uuid',
      event_id: validEventId,
      calendar_id: reposterCalendarId,
    });

    const mockTransaction = stubCommonDependencies({
      eventEntity: mockEvent,
      categories: [mockCategory],
      userCalendars: [new Calendar(reposterCalendarId, 'reposter-calendar')],
      repostEntity: [mockRepost],
    });

    sandbox.stub(EventCategoryAssignmentEntity, 'destroy').resolves(0);
    sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').resolves([]);

    const returnedEvent = new CalendarEvent(validEventId, reposterCalendarId);
    sandbox.stub(service, 'getEventById').resolves(returnedEvent);

    const result = await service.replaceEventCategories(
      mockAccount, validEventId, [validCategoryId1],
    );

    // SharedEventEntity 'auto' wins over the EventRepostEntity legacy row.
    expect(result.repostStatus).toBe('auto');
    expect(result.isRepost).toBe(true);
    expect((mockTransaction.commit as sinon.SinonStub).calledOnce).toBe(true);
  });
});
