import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { Op } from 'sequelize';
import EventService from '@/server/calendar/service/events';
import CalendarService from '@/server/calendar/service/calendar';
import CategoryService from '@/server/calendar/service/categories';
import { EventEmitter } from 'events';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { EventContentEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import { EventRepostEntity } from '@/server/calendar/entity/event_repost';

describe('EventService - Calendar ID Storage', () => {
  let sandbox: sinon.SinonSandbox;
  let eventService: EventService;
  let calendarService: CalendarService;
  let categoryService: CategoryService;
  let eventBus: EventEmitter;
  let account: Account;
  let calendar: Calendar;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    eventService = new EventService(eventBus);
    calendarService = new CalendarService();
    categoryService = new CategoryService();

    // Setup test account
    account = new Account('test-account-id', 'test@example.com', true, true);

    // Setup test calendar with urlName
    calendar = new Calendar('test-calendar-id', 'testcalendar');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should store calendar UUID as calendar_id for local events', async () => {
    // Stub methods to avoid database calls
    sandbox.stub(calendarService, 'getCalendar').resolves(calendar);
    sandbox.stub(calendarService, 'editableCalendarsForUser').resolves([calendar]);

    // Stub database save operations
    const eventEntitySaveStub = sandbox.stub(EventEntity.prototype, 'save').resolves();
    sandbox.stub(EventContentEntity.prototype, 'save').resolves();
    sandbox.stub(EventScheduleEntity.prototype, 'save').resolves();

    const eventParams = {
      calendarId: calendar.id,
      content: {
        en: {
          name: 'Test Event',
          description: 'Test Description',
        },
      },
      schedules: [{
        start: new Date('2026-01-15T10:00:00Z'),
        end: new Date('2026-01-15T11:00:00Z'),
      }],
    };

    // Inject stubbed calendar service
    (eventService as any).calendarService = calendarService;

    await eventService.createEvent(account, eventParams);

    // Verify EventEntity was saved with calendar UUID
    expect(eventEntitySaveStub.calledOnce).toBe(true);
    const savedEntity = eventEntitySaveStub.thisValues[0] as EventEntity;
    expect(savedEntity.calendar_id).toBe(calendar.id);
  });

  it('should use calendar UUID for listEvents filtering with reposts support', async () => {
    // Stub EventRepostEntity.findAll to simulate no reposts
    sandbox.stub(EventRepostEntity, 'findAll').resolves([]);

    // Stub EventEntity.findAll to capture where clause
    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves([]);

    await eventService.listEvents(calendar);

    expect(findAllStub.calledOnce).toBe(true);
    const queryOptions = findAllStub.firstCall.args[0] as any;

    // Verify the query uses Op.or with calendar_id
    expect(queryOptions.where[Op.or]).toBeDefined();
    const orConditions = queryOptions.where[Op.or];

    // First condition should be owned events (calendar_id matches)
    expect(orConditions[0].calendar_id).toBe(calendar.id);
  });

  it('should include reposted events in listEvents', async () => {
    const repostedEventId = 'reposted-event-uuid';

    // Stub EventRepostEntity.findAll to return a reposted event
    sandbox.stub(EventRepostEntity, 'findAll').resolves([
      { event_id: repostedEventId } as any,
    ]);

    // Stub EventEntity.findAll to capture where clause
    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves([]);

    await eventService.listEvents(calendar);

    expect(findAllStub.calledOnce).toBe(true);
    const queryOptions = findAllStub.firstCall.args[0] as any;

    // Verify the query includes both owned and reposted events
    expect(queryOptions.where[Op.or]).toBeDefined();
    const orConditions = queryOptions.where[Op.or];

    // Should have two conditions: owned events and reposted events
    expect(orConditions.length).toBe(2);

    // First condition: owned events
    expect(orConditions[0].calendar_id).toBe(calendar.id);

    // Second condition: reposted events
    expect(orConditions[1].id[Op.in]).toContain(repostedEventId);
  });

  it('should retrieve event with UUID calendar_id via getEventById', async () => {
    const eventId = 'test-event-uuid';

    const mockEvent = EventEntity.build({
      id: eventId,
      calendar_id: calendar.id,
      event_source_url: '/testcalendar/event-1',
    });

    // Stub database queries
    sandbox.stub(EventEntity, 'findOne').resolves(mockEvent);
    sandbox.stub(categoryService, 'getEventCategories').resolves([]);

    // Inject stubbed category service
    (eventService as any).categoryService = categoryService;

    const result = await eventService.getEventById(eventId);

    expect(result.calendarId).toBe(calendar.id);
    expect(result.id).toBe(eventId);
  });

  it('should return null calendarId for remote events', async () => {
    const eventId = 'remote-event-uuid';

    // Remote events have null calendar_id
    const mockEvent = EventEntity.build({
      id: eventId,
      calendar_id: null,
      event_source_url: 'https://remote.example.com/events/123',
    });

    // Stub database queries
    sandbox.stub(EventEntity, 'findOne').resolves(mockEvent);
    sandbox.stub(categoryService, 'getEventCategories').resolves([]);

    // Inject stubbed category service
    (eventService as any).categoryService = categoryService;

    const result = await eventService.getEventById(eventId);

    expect(result.calendarId).toBeNull();
    expect(result.isRemote()).toBe(true);
    expect(result.isLocal()).toBe(false);
  });
});
