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
import { BulkEventsNotFoundError, MixedCalendarEventsError, CategoriesNotFoundError } from '@/common/exceptions/calendar';
import db from '@/server/common/entity/db';
import type { Transaction } from 'sequelize';

/**
 * Builds a stub ActivityPubInterface that returns the supplied SharedEventEntity
 * status map from getSharedEventStatusMap. Mirrors the helper used in
 * event_service.test.ts so authoritative repostStatus resolution can be driven
 * from the test inputs.
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
  // Default behavior: return [] for any event id not explicitly mapped.
  getCalendarIdsForSharedEvent.callsFake(async (eventId: string) => {
    return calendarIdsForEvent[eventId] ?? [];
  });
  return {
    getSharedEventIds: sinon.stub().resolves(sharedEventIds),
    getSharedEventStatusMap: sinon.stub().resolves(statusMap),
    getCalendarIdsForSharedEvent,
  } as any;
}

describe('EventService.bulkAssignCategories', () => {
  let service: EventService;
  let sandbox = sinon.createSandbox();
  let mockAccount: Account;

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    // Default AP interface returns no shared events; tests that need
    // SharedEventEntity-driven repostStatus override this in-test.
    service.setActivityPubInterface(buildMockApInterface());
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

    // Post-commit repostStatus lookup queries EventRepostEntity by calendar_id;
    // for owned events there are no rows, so the resolved status falls back
    // to 'none' (matched by getSharedEventStatusMap returning empty in beforeEach).
    sandbox.stub(EventRepostEntity, 'findAll').resolves([]);

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
      const ev = new CalendarEvent(id, calendarId);
      ev.categories = mockCategories.map(cat => cat.toModel());
      getEventByIdStub.withArgs(id).resolves(ev);
    });

    // Act
    const result = await service.bulkAssignCategories(mockAccount, eventIds, categoryIds);

    // Assert
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('11111111-1111-4111-8111-111111111111');
    expect(result[1].id).toBe('22222222-2222-4222-8222-222222222222');
    expect(result[2].id).toBe('33333333-3333-4333-8333-333333333333');
    // Owned events: authoritative repostStatus is 'none' (no SharedEventEntity
    // or EventRepostEntity row matching the acting calendar).
    result.forEach(r => {
      expect(r.repostStatus).toBe('none');
      expect(r.isRepost).toBe(false);
    });
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

    // Post-commit repostStatus lookup: owned event, no repost rows.
    sandbox.stub(EventRepostEntity, 'findAll').resolves([]);

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
    const returnedEvent = new CalendarEvent('11111111-1111-4111-8111-111111111111', calendarId);
    returnedEvent.categories = mockCategories.map(cat => cat.toModel());
    getEventByIdStub.withArgs('11111111-1111-4111-8111-111111111111').resolves(returnedEvent);

    // Act
    const result = await service.bulkAssignCategories(mockAccount, eventIds, categoryIds);

    // Assert
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('11111111-1111-4111-8111-111111111111');
    // Owned event: authoritative repostStatus is 'none'.
    expect(result[0].repostStatus).toBe('none');
    expect(mockTransaction.commit.calledOnce).toBe(true);
    // Only cat2 should be newly assigned (cat1 was already assigned)
  });

  it('should assign categories to a reposted event using the reposter calendar', async () => {
    // When the event belongs to a different calendar (original owner), but the user
    // has reposter calendar access, categories from the reposter calendar should be usable.
    const eventId = '11111111-1111-4111-8111-111111111111';
    const categoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const originalCalendarId = 'original-calendar-uuid';
    const reposterCalendarId = 'reposter-calendar-uuid';

    const mockEvent = EventEntity.build({
      id: eventId,
      calendar_id: originalCalendarId,
      account_id: 'other-account-id',
    });

    const mockCategory = EventCategoryEntity.build({
      id: categoryId,
      calendar_id: reposterCalendarId,
    });

    const mockRepost = EventRepostEntity.build({
      id: 'repost-uuid',
      event_id: eventId,
      calendar_id: reposterCalendarId,
    });

    sandbox.stub(EventEntity, 'findAll').resolves([mockEvent]);

    // editableCalendarsForUser returns the reposter's calendar, not original
    sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser')
      .resolves([new Calendar(reposterCalendarId, 'reposter-calendar')]);

    sandbox.stub(EventRepostEntity, 'findAll').resolves([mockRepost]);

    sandbox.stub(CalendarService.prototype, 'getCalendar')
      .resolves(new Calendar(reposterCalendarId, 'reposter-calendar'));

    sandbox.stub(EventCategoryEntity, 'findAll').resolves([mockCategory]);

    sandbox.stub(EventCategoryAssignmentEntity, 'findAll').resolves([]);

    const mockTransaction = {
      commit: sandbox.stub().resolves(),
      rollback: sandbox.stub().resolves(),
      afterCommit: sandbox.stub(),
      LOCK: {},
    } as unknown as Transaction;
    sandbox.stub(db, 'transaction').resolves(mockTransaction);

    const bulkCreateStub = sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').resolves([]);

    const getEventByIdStub = sandbox.stub(service, 'getEventById');
    const returnedEvent = new CalendarEvent(eventId, reposterCalendarId);
    getEventByIdStub.withArgs(eventId).resolves(returnedEvent);

    const result = await service.bulkAssignCategories(mockAccount, [eventId], [categoryId]);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(bulkCreateStub.calledOnce).toBe(true);
    expect(mockTransaction.commit.calledOnce).toBe(true);
    // The event lives in EventRepostEntity (legacy direct-repost link) but not
    // in SharedEventEntity (the AP mock returns an empty status map). The
    // legacy fallback resolves to 'manual'.
    expect(result[0].repostStatus).toBe('manual');
    expect(result[0].isRepost).toBe(true);
  });

  it('should set repostStatus="auto" when SharedEventEntity reports auto_posted (pv-7kxw.1)', async () => {
    // pv-7kxw.1 (option b): bulkAssignCategories now consults
    // getSharedEventStatusMap post-commit and sets repostStatus
    // authoritatively. An event reported as 'auto' by SharedEventEntity must
    // surface as 'auto' in the return shape — the lossy 'manual' synthesis is
    // gone. Companion bead pv-7kxw.2 will add additional lock-in coverage.
    const eventId = '11111111-1111-4111-8111-111111111111';
    const categoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const originalCalendarId = 'original-calendar-uuid';
    const reposterCalendarId = 'reposter-calendar-uuid';

    // SharedEventEntity reports the event as auto-posted on the reposter.
    service.setActivityPubInterface(
      buildMockApInterface([eventId], { [eventId]: 'auto' }),
    );

    const mockEvent = EventEntity.build({
      id: eventId,
      calendar_id: originalCalendarId,
      account_id: 'other-account-id',
    });

    const mockCategory = EventCategoryEntity.build({
      id: categoryId,
      calendar_id: reposterCalendarId,
    });

    const mockRepost = EventRepostEntity.build({
      id: 'repost-uuid',
      event_id: eventId,
      calendar_id: reposterCalendarId,
    });

    sandbox.stub(EventEntity, 'findAll').resolves([mockEvent]);

    sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser')
      .resolves([new Calendar(reposterCalendarId, 'reposter-calendar')]);

    // EventRepostEntity.findAll is consulted twice: once inside
    // resolveEffectiveCalendarId (event_id filter) and once post-commit
    // (calendar_id filter). The flat stub satisfies both shapes.
    sandbox.stub(EventRepostEntity, 'findAll').resolves([mockRepost]);

    sandbox.stub(CalendarService.prototype, 'getCalendar')
      .resolves(new Calendar(reposterCalendarId, 'reposter-calendar'));

    sandbox.stub(EventCategoryEntity, 'findAll').resolves([mockCategory]);
    sandbox.stub(EventCategoryAssignmentEntity, 'findAll').resolves([]);

    const mockTransaction = {
      commit: sandbox.stub().resolves(),
      rollback: sandbox.stub().resolves(),
      afterCommit: sandbox.stub(),
      LOCK: {},
    } as unknown as Transaction;
    sandbox.stub(db, 'transaction').resolves(mockTransaction);

    sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').resolves([]);

    const returnedEvent = new CalendarEvent(eventId, reposterCalendarId);
    const getEventByIdStub = sandbox.stub(service, 'getEventById');
    getEventByIdStub.withArgs(eventId).resolves(returnedEvent);

    const result = await service.bulkAssignCategories(mockAccount, [eventId], [categoryId]);

    // SharedEventEntity takes precedence over EventRepostEntity legacy fallback.
    expect(result).toHaveLength(1);
    expect(result[0].repostStatus).toBe('auto');
    expect(result[0].isRepost).toBe(true);
  });

  it('should set repostStatus="manual" via EventRepostEntity legacy fallback (pv-7kxw.1)', async () => {
    // pv-7kxw.1 (option b): when SharedEventEntity has no entry but
    // EventRepostEntity does (legacy direct-repost link), the resolved
    // repostStatus is 'manual'. This proves the fallback chain matches the
    // listEvents resolution.
    const eventId = '11111111-1111-4111-8111-111111111111';
    const categoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const originalCalendarId = 'original-calendar-uuid';
    const reposterCalendarId = 'reposter-calendar-uuid';

    // beforeEach already wires an empty getSharedEventStatusMap.
    const mockEvent = EventEntity.build({
      id: eventId,
      calendar_id: originalCalendarId,
      account_id: 'other-account-id',
    });

    const mockCategory = EventCategoryEntity.build({
      id: categoryId,
      calendar_id: reposterCalendarId,
    });

    const mockRepost = EventRepostEntity.build({
      id: 'repost-uuid',
      event_id: eventId,
      calendar_id: reposterCalendarId,
    });

    sandbox.stub(EventEntity, 'findAll').resolves([mockEvent]);

    sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser')
      .resolves([new Calendar(reposterCalendarId, 'reposter-calendar')]);

    sandbox.stub(EventRepostEntity, 'findAll').resolves([mockRepost]);

    sandbox.stub(CalendarService.prototype, 'getCalendar')
      .resolves(new Calendar(reposterCalendarId, 'reposter-calendar'));

    sandbox.stub(EventCategoryEntity, 'findAll').resolves([mockCategory]);
    sandbox.stub(EventCategoryAssignmentEntity, 'findAll').resolves([]);

    const mockTransaction = {
      commit: sandbox.stub().resolves(),
      rollback: sandbox.stub().resolves(),
      afterCommit: sandbox.stub(),
      LOCK: {},
    } as unknown as Transaction;
    sandbox.stub(db, 'transaction').resolves(mockTransaction);

    sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').resolves([]);

    const returnedEvent = new CalendarEvent(eventId, reposterCalendarId);
    const getEventByIdStub = sandbox.stub(service, 'getEventById');
    getEventByIdStub.withArgs(eventId).resolves(returnedEvent);

    const result = await service.bulkAssignCategories(mockAccount, [eventId], [categoryId]);

    expect(result).toHaveLength(1);
    expect(result[0].repostStatus).toBe('manual');
    expect(result[0].isRepost).toBe(true);
  });

  it('should set repostStatus="none" for owned events with no repost rows (pv-7kxw.1)', async () => {
    // pv-7kxw.1 (option b): owned events have no SharedEventEntity entry and
    // no EventRepostEntity row matching the acting calendar — repostStatus
    // resolves to 'none' (the default from the resolved status map).
    const eventId = '11111111-1111-4111-8111-111111111111';
    const categoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const calendarId = 'local-calendar-uuid';

    const mockEvent = EventEntity.build({
      id: eventId,
      calendar_id: calendarId,
      account_id: 'test-account-id',
    });

    const mockCategory = EventCategoryEntity.build({
      id: categoryId,
      calendar_id: calendarId,
    });

    sandbox.stub(EventEntity, 'findAll').resolves([mockEvent]);

    // User owns the calendar directly — no repost resolution needed.
    sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser')
      .resolves([new Calendar(calendarId, 'local-calendar')]);

    sandbox.stub(CalendarService.prototype, 'getCalendar')
      .resolves(new Calendar(calendarId, 'local-calendar'));

    sandbox.stub(EventCategoryEntity, 'findAll').resolves([mockCategory]);
    sandbox.stub(EventCategoryAssignmentEntity, 'findAll').resolves([]);

    // Post-commit lookup queries EventRepostEntity by calendar_id; no rows.
    sandbox.stub(EventRepostEntity, 'findAll').resolves([]);

    const mockTransaction = {
      commit: sandbox.stub().resolves(),
      rollback: sandbox.stub().resolves(),
      afterCommit: sandbox.stub(),
      LOCK: {},
    } as unknown as Transaction;
    sandbox.stub(db, 'transaction').resolves(mockTransaction);

    sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').resolves([]);

    const returnedEvent = new CalendarEvent(eventId, calendarId);
    const getEventByIdStub = sandbox.stub(service, 'getEventById');
    getEventByIdStub.withArgs(eventId).resolves(returnedEvent);

    const result = await service.bulkAssignCategories(mockAccount, [eventId], [categoryId]);

    expect(result).toHaveLength(1);
    expect(result[0].repostStatus).toBe('none');
    expect(result[0].isRepost).toBe(false);
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

describe('EventService.resolveEffectiveCalendarId', () => {
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

  it('should return the original calendarId when account owns the calendar', async () => {
    const calendarId = 'ownedcal-0000-4000-8000-000000000001';
    const eventIds = ['event-id-0000-4000-8000-000000000001'];
    const mockTransaction = {
      commit: sandbox.stub().resolves(),
      rollback: sandbox.stub().resolves(),
    } as unknown as Transaction;

    sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser')
      .resolves([new Calendar(calendarId, 'my-calendar')]);

    const result = await (service as any).resolveEffectiveCalendarId(
      mockAccount, calendarId, eventIds, mockTransaction,
    );

    expect(result.effectiveCalendarId).toBe(calendarId);
    expect(result.wasRepost).toBe(false);
    expect(result.userCalendars).toHaveLength(1);
  });

  it('should resolve to repost calendar when events are reposts', async () => {
    const originalCalendarId = 'foreigncal-0000-4000-8000-000000000001';
    const repostCalendarId  = 'repostcal-0000-4000-8000-000000000001';
    const eventIds = ['event-id-0000-4000-8000-000000000001'];
    const mockTransaction = {
      commit: sandbox.stub().resolves(),
      rollback: sandbox.stub().resolves(),
    } as unknown as Transaction;

    sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser')
      .resolves([new Calendar(repostCalendarId, 'my-calendar')]);

    sandbox.stub(EventRepostEntity, 'findAll').resolves([
      EventRepostEntity.build({ event_id: eventIds[0], calendar_id: repostCalendarId }),
    ] as any);

    const result = await (service as any).resolveEffectiveCalendarId(
      mockAccount, originalCalendarId, eventIds, mockTransaction,
    );

    expect(result.effectiveCalendarId).toBe(repostCalendarId);
    expect(result.wasRepost).toBe(true);
  });

  it('should leave effectiveCalendarId unresolved when account owns neither calendar', async () => {
    const foreignCalendarId = 'foreigncal-0000-4000-8000-000000000001';
    const ownedCalendarId   = 'ownedcal-0000-4000-8000-000000000001';
    const eventIds = ['event-id-0000-4000-8000-000000000001'];
    const mockTransaction = {
      commit: sandbox.stub().resolves(),
      rollback: sandbox.stub().resolves(),
    } as unknown as Transaction;

    sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser')
      .resolves([new Calendar(ownedCalendarId, 'my-calendar')]);

    // No matching reposts either
    sandbox.stub(EventRepostEntity, 'findAll').resolves([]);

    const result = await (service as any).resolveEffectiveCalendarId(
      mockAccount, foreignCalendarId, eventIds, mockTransaction,
    );

    // The method doesn't throw; the caller's permission check will throw
    expect(result.effectiveCalendarId).toBe(foreignCalendarId);
    expect(result.wasRepost).toBe(false);
  });
});
