import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { EventCategoryEntity } from '@/server/calendar/entity/event_category';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import EventService from '@/server/calendar/service/events';
import CalendarService from '@/server/calendar/service/calendar';
import { BulkEventsNotFoundError, MixedCalendarEventsError, CategoriesNotFoundError } from '@/common/exceptions/calendar';
import db from '@/server/common/entity/db';
import type { Transaction } from 'sequelize';

describe('EventService.bulkAssignCategories', () => {
  let service: EventService;
  let sandbox = sinon.createSandbox();
  let mockAccount: Account;

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    mockAccount = new Account('test-account-id', 'test@example.com');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should assign categories to multiple events successfully', async () => {
    // Arrange
    const eventIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
    const categoryIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
    const calendarId = 'calendar1';

    // Mock events - use UUID for calendar_id (local events)
    const mockEvents = eventIds.map(id => EventEntity.build({
      id,
      calendar_id: calendarId,
      account_id: 'test-account-id',
    }));

    // Mock categories - use UUID for calendar_id
    const mockCategories = categoryIds.map(id => EventCategoryEntity.build({
      id,
      calendar_id: calendarId,
    }));

    // Stub database calls
    const findEventsStub = sandbox.stub(EventEntity, 'findAll');
    findEventsStub.resolves(mockEvents);

    const findCategoriesStub = sandbox.stub(EventCategoryEntity, 'findAll');
    findCategoriesStub.resolves(mockCategories);

    const calendarServiceStub = sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser');
    calendarServiceStub.resolves([new Calendar(calendarId, 'test-calendar')]);

    // Stub getCalendar to return calendar with matching ID
    const getCalendarStub = sandbox.stub(CalendarService.prototype, 'getCalendar');
    getCalendarStub.resolves(new Calendar(calendarId, 'testcalendar'));

    // Mock existing assignments check
    const findExistingStub = sandbox.stub(EventCategoryAssignmentEntity, 'findAll');
    findExistingStub.resolves([]);

    // Mock transaction
    const mockTransaction = {
      commit: sandbox.stub().resolves(),
      rollback: sandbox.stub().resolves(),
      afterCommit: sandbox.stub(),
      LOCK: {},
    } as unknown as Transaction;
    const transactionStub = sandbox.stub(db, 'transaction');
    transactionStub.resolves(mockTransaction);

    // Mock bulk create
    const bulkCreateStub = sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate');
    bulkCreateStub.resolves([]);

    // Mock getEventById for the return values
    const getEventByIdStub = sandbox.stub(service, 'getEventById');
    eventIds.forEach(id => {
      getEventByIdStub.withArgs(id).resolves({
        id,
        calendarId,
        categories: mockCategories.map(cat => cat.toModel()),
      } as any);
    });

    // Act
    const result = await service.bulkAssignCategories(mockAccount, eventIds, categoryIds);

    // Assert
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('11111111-1111-4111-8111-111111111111');
    expect(result[1].id).toBe('22222222-2222-4222-8222-222222222222');
    expect(result[2].id).toBe('33333333-3333-4333-8333-333333333333');
    expect(bulkCreateStub.calledOnce).toBe(true);
    expect(mockTransaction.commit.calledOnce).toBe(true);
  });

  it('should handle events not found error', async () => {
    // Arrange
    const eventIds = ['99999999-9999-4999-8999-999999999991', '99999999-9999-4999-8999-999999999992'];
    const categoryIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'];

    const findEventsStub = sandbox.stub(EventEntity, 'findAll');
    findEventsStub.resolves([]);

    // Act & Assert
    await expect(service.bulkAssignCategories(mockAccount, eventIds, categoryIds))
      .rejects.toThrow(BulkEventsNotFoundError);
  });

  it('should handle categories not found error', async () => {
    // Arrange
    const eventIds = ['11111111-1111-4111-8111-111111111111'];
    const categoryIds = ['99999999-9999-4999-8999-999999999999'];
    const calendarId = 'calendar1';

    const mockEvents = [EventEntity.build({
      id: '11111111-1111-4111-8111-111111111111',
      calendar_id: calendarId,
      account_id: 'test-account-id',
    })];

    const findEventsStub = sandbox.stub(EventEntity, 'findAll');
    findEventsStub.resolves(mockEvents);

    const findCategoriesStub = sandbox.stub(EventCategoryEntity, 'findAll');
    findCategoriesStub.resolves([]);

    const calendarServiceStub = sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser');
    calendarServiceStub.resolves([new Calendar(calendarId, 'test-calendar')]);

    // Stub getCalendar to return calendar with matching ID
    const getCalendarStub = sandbox.stub(CalendarService.prototype, 'getCalendar');
    getCalendarStub.resolves(new Calendar(calendarId, 'testcalendar'));

    // Act & Assert
    await expect(service.bulkAssignCategories(mockAccount, eventIds, categoryIds))
      .rejects.toThrow(CategoriesNotFoundError);
  });

  it('should handle mixed calendar events error', async () => {
    // Arrange
    const eventIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    const categoryIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'];

    // Events with DIFFERENT calendar UUIDs to trigger mixed calendar error
    const mockEvents = [
      EventEntity.build({ id: '11111111-1111-4111-8111-111111111111', calendar_id: 'calendar1', account_id: 'test-account-id' }),
      EventEntity.build({ id: '22222222-2222-4222-8222-222222222222', calendar_id: 'calendar2', account_id: 'test-account-id' }),
    ];

    const findEventsStub = sandbox.stub(EventEntity, 'findAll');
    findEventsStub.resolves(mockEvents);

    const calendarServiceStub = sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser');
    calendarServiceStub.resolves([
      new Calendar('calendar1', 'test-calendar1'),
      new Calendar('calendar2', 'test-calendar2'),
    ]);

    // Act & Assert
    await expect(service.bulkAssignCategories(mockAccount, eventIds, categoryIds))
      .rejects.toThrow(MixedCalendarEventsError);
  });

  it('should skip already assigned categories and report success', async () => {
    // Arrange
    const eventIds = ['11111111-1111-4111-8111-111111111111'];
    const categoryIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
    const calendarId = 'calendar1';

    const mockEvents = [EventEntity.build({
      id: '11111111-1111-4111-8111-111111111111',
      calendar_id: calendarId,
      account_id: 'test-account-id',
    })];

    const mockCategories = categoryIds.map(id => EventCategoryEntity.build({
      id,
      calendar_id: calendarId,
    }));

    // Mock existing assignment for cat1
    const existingAssignments = [
      EventCategoryAssignmentEntity.build({
        id: 'assign1',
        event_id: '11111111-1111-4111-8111-111111111111',
        category_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    ];

    const findEventsStub = sandbox.stub(EventEntity, 'findAll');
    findEventsStub.resolves(mockEvents);

    const findCategoriesStub = sandbox.stub(EventCategoryEntity, 'findAll');
    findCategoriesStub.resolves(mockCategories);

    const calendarServiceStub = sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser');
    calendarServiceStub.resolves([new Calendar(calendarId, 'test-calendar')]);

    // Stub getCalendar to return calendar with matching ID
    const getCalendarStub = sandbox.stub(CalendarService.prototype, 'getCalendar');
    getCalendarStub.resolves(new Calendar(calendarId, 'testcalendar'));

    const findExistingStub = sandbox.stub(EventCategoryAssignmentEntity, 'findAll');
    findExistingStub.resolves(existingAssignments);

    const mockTransaction = {
      commit: sandbox.stub().resolves(),
      rollback: sandbox.stub().resolves(),
      afterCommit: sandbox.stub(),
      LOCK: {},
    } as unknown as Transaction;
    const transactionStub = sandbox.stub(db, 'transaction');
    transactionStub.resolves(mockTransaction);

    const bulkCreateStub = sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate');
    bulkCreateStub.resolves([]);

    // Mock getEventById for the return values
    const getEventByIdStub = sandbox.stub(service, 'getEventById');
    getEventByIdStub.withArgs('11111111-1111-4111-8111-111111111111').resolves({
      id: '11111111-1111-4111-8111-111111111111',
      calendarId,
      categories: mockCategories.map(cat => cat.toModel()),
    } as any);

    // Act
    const result = await service.bulkAssignCategories(mockAccount, eventIds, categoryIds);

    // Assert
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('11111111-1111-4111-8111-111111111111');
    expect(mockTransaction.commit.calledOnce).toBe(true);
    // Only cat2 should be newly assigned (cat1 was already assigned)
  });

  it('should rollback transaction on error', async () => {
    // Arrange
    const eventIds = ['11111111-1111-4111-8111-111111111111'];
    const categoryIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'];
    const calendarId = 'calendar1';

    const mockEvents = [EventEntity.build({
      id: '11111111-1111-4111-8111-111111111111',
      calendar_id: calendarId,
      account_id: 'test-account-id',
    })];

    const mockCategories = [EventCategoryEntity.build({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      calendar_id: calendarId,
    })];

    const findEventsStub = sandbox.stub(EventEntity, 'findAll');
    findEventsStub.resolves(mockEvents);

    const findCategoriesStub = sandbox.stub(EventCategoryEntity, 'findAll');
    findCategoriesStub.resolves(mockCategories);

    const calendarServiceStub = sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser');
    calendarServiceStub.resolves([new Calendar(calendarId, 'test-calendar')]);

    // Stub getCalendar to return calendar with matching ID
    const getCalendarStub = sandbox.stub(CalendarService.prototype, 'getCalendar');
    getCalendarStub.resolves(new Calendar(calendarId, 'testcalendar'));

    const findExistingStub = sandbox.stub(EventCategoryAssignmentEntity, 'findAll');
    findExistingStub.resolves([]);

    const mockTransaction = {
      commit: sandbox.stub().resolves(),
      rollback: sandbox.stub().resolves(),
      afterCommit: sandbox.stub(),
      LOCK: {},
    } as unknown as Transaction;
    const transactionStub = sandbox.stub(db, 'transaction');
    transactionStub.resolves(mockTransaction);

    // Mock bulk create to throw error
    const bulkCreateStub = sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate');
    bulkCreateStub.rejects(new Error('Database error'));

    // Act & Assert
    await expect(service.bulkAssignCategories(mockAccount, eventIds, categoryIds))
      .rejects.toThrow('Database error');

    expect((mockTransaction.rollback as sinon.SinonStub).calledOnce).toBe(true);
  });
});
