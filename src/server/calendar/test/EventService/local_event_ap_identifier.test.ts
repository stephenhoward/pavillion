import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import config from 'config';
import { Op } from 'sequelize';
import EventService from '@/server/calendar/service/events';
import CalendarService from '@/server/calendar/service/calendar';
import CategoryService from '@/server/calendar/service/categories';
import { EventEmitter } from 'events';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { EventContentEntity, EventScheduleEntity } from '@/server/calendar/entity/event';

describe('EventService - AP Identifier Storage', () => {
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

  it('should store AP identifier (format: https://{domain}/o/{urlName}) as calendar_id', async () => {
    // Stub methods to avoid database calls
    sandbox.stub(calendarService, 'getCalendar').resolves(calendar);
    sandbox.stub(calendarService, 'editableCalendarsForUser').resolves([calendar]);

    // Stub database save operations
    const eventEntitySaveStub = sandbox.stub(EventEntity.prototype, 'save').resolves();
    sandbox.stub(EventContentEntity.prototype, 'save').resolves();
    sandbox.stub(EventScheduleEntity.prototype, 'save').resolves();

    const domain = config.get('domain');
    const expectedCalendarId = `https://${domain}/o/${calendar.urlName}`;

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

    // Verify EventEntity was saved with AP identifier
    expect(eventEntitySaveStub.calledOnce).toBe(true);
    const savedEntity = eventEntitySaveStub.thisValues[0] as EventEntity;
    expect(savedEntity.calendar_id).toBe(expectedCalendarId);
    expect(savedEntity.calendar_id).toMatch(/^https:\/\/.+\/o\/.+$/);
  });

  it('should work for calendar with valid urlName', async () => {
    const calendarWithUrlName = new Calendar('test-calendar-id-2', 'mycalendar');

    sandbox.stub(calendarService, 'getCalendar').resolves(calendarWithUrlName);
    sandbox.stub(calendarService, 'editableCalendarsForUser').resolves([calendarWithUrlName]);

    // Stub database save operations
    const eventEntitySaveStub = sandbox.stub(EventEntity.prototype, 'save').resolves();
    sandbox.stub(EventContentEntity.prototype, 'save').resolves();
    sandbox.stub(EventScheduleEntity.prototype, 'save').resolves();

    const domain = config.get('domain');
    const expectedCalendarId = `https://${domain}/o/mycalendar`;

    const eventParams = {
      calendarId: calendarWithUrlName.id,
      content: {
        en: { name: 'My Event', description: 'Description' },
      },
      schedules: [{
        start: new Date('2026-01-15T10:00:00Z'),
        end: new Date('2026-01-15T11:00:00Z'),
      }],
    };

    (eventService as any).calendarService = calendarService;

    await eventService.createEvent(account, eventParams);

    const savedEntity = eventEntitySaveStub.thisValues[0] as EventEntity;
    expect(savedEntity.calendar_id).toBe(expectedCalendarId);
  });

  it('should use AP identifier for listEvents filtering', async () => {
    const domain = config.get('domain');
    const expectedCalendarId = `https://${domain}/o/${calendar.urlName}`;

    // Stub EventEntity.findAll to capture where clause
    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves([]);

    await eventService.listEvents(calendar);

    expect(findAllStub.calledOnce).toBe(true);
    const queryOptions = findAllStub.firstCall.args[0] as any;
    // Verify that both UUID and AP identifier are included in the query
    expect(queryOptions.where.calendar_id).toEqual({
      [Op.in]: [calendar.id, expectedCalendarId],
    });
  });

  it('should retrieve event with AP identifier calendar_id via getEventById', async () => {
    const domain = config.get('domain');
    const expectedCalendarId = `https://${domain}/o/${calendar.urlName}`;

    const mockEvent = EventEntity.build({
      id: 'https://example.com/events/test-event',
      calendar_id: expectedCalendarId,
      event_source_url: '/testcalendar/event-1',
    });

    // Stub database queries
    sandbox.stub(EventEntity, 'findOne').resolves(mockEvent);
    sandbox.stub(categoryService, 'getEventCategories').resolves([]);

    // Inject stubbed category service
    (eventService as any).categoryService = categoryService;

    const result = await eventService.getEventById('https://example.com/events/test-event');

    expect(result.calendarId).toBe(expectedCalendarId);
    expect(result.id).toBe('https://example.com/events/test-event');
  });
});
