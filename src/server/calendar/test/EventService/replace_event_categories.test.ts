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
    returnedEvent.isRepost = false;
    sandbox.stub(service, 'getEventById').resolves(returnedEvent);

    const result = await service.replaceEventCategories(
      mockAccount, validEventId, [validCategoryId1],
    );

    expect(result).toBeDefined();
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
    });

    sandbox.stub(EventCategoryAssignmentEntity, 'destroy').resolves(0);

    const returnedEvent = new CalendarEvent(validEventId, calendarId);
    returnedEvent.isRepost = false;
    sandbox.stub(service, 'getEventById').resolves(returnedEvent);

    const result = await service.replaceEventCategories(mockAccount, validEventId, []);

    expect(result.isRepost).toBe(false);
  });
});
