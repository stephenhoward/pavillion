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
import { SharedEventEntity } from '@/server/activitypub/entity/activitypub';

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

    // Inject a minimal AP interface stub so listEvents does not crash when
    // no real ActivityPub domain is wired up in these unit tests.
    (eventService as any).activityPubInterface = {
      getSharedEventStatusMap: async () => new Map<string, 'auto' | 'manual'>(),
    };

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
    // Stub SharedEventEntity.findAll to simulate no auto-reposted events
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);

    // After the listEventIdsForCalendar extraction (pv-hr72.1) the visible
    // event-id union is materialized in the helper and listEvents queries
    // EventEntity with `WHERE id IN (...)`. The helper itself queries
    // EventEntity for own-event ids before listEvents materializes the
    // include-loaded rows, so findAll is invoked twice.
    const ownedEvent = EventEntity.build({ id: 'owned-event-uuid', calendar_id: calendar.id });
    const findAllStub = sandbox.stub(EventEntity, 'findAll');
    findAllStub.onFirstCall().resolves([ownedEvent]);
    findAllStub.onSecondCall().resolves([]);

    await eventService.listEvents(calendar);

    expect(findAllStub.callCount).toBe(2);
    const queryOptions = findAllStub.lastCall.args[0] as any;

    // The second call is the materialization query, scoped to the union of
    // visible event ids. With no reposts/shares the union contains only the
    // calendar's own event ids.
    expect(queryOptions.where.id[Op.in]).toContain('owned-event-uuid');
  });

  it('should include reposted events in listEvents', async () => {
    const repostedEventId = 'reposted-event-uuid';

    // Stub EventRepostEntity.findAll to return a reposted event
    sandbox.stub(EventRepostEntity, 'findAll').resolves([
      { event_id: repostedEventId } as any,
    ]);
    // Stub SharedEventEntity.findAll to simulate no auto-reposted events
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);

    // findAll is invoked twice: helper enumerates own-event ids first, then
    // listEvents materializes the include-loaded rows scoped to the visible-id
    // union (own ∪ reposts ∪ shares).
    const findAllStub = sandbox.stub(EventEntity, 'findAll');
    findAllStub.onFirstCall().resolves([]); // no owned events in this scenario
    findAllStub.onSecondCall().resolves([]);

    await eventService.listEvents(calendar);

    expect(findAllStub.callCount).toBe(2);
    const queryOptions = findAllStub.lastCall.args[0] as any;

    // The materialization query scopes to the union, which here is just the
    // reposted-event id surfaced by EventRepostEntity.
    expect(queryOptions.where.id[Op.in]).toContain(repostedEventId);
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
