import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import EventService from '@/client/service/event';
import ModelService from '@/client/service/models';
import ListResult from '@/client/service/list-result';
import { CalendarEvent } from '@/common/model/events';
import { Calendar } from '@/common/model/calendar';
import { useEventStore } from '@/client/stores/eventStore';

describe('initEvent', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: ReturnType<typeof useEventStore>;
  let service: EventService;

  beforeEach(() => {
    // Create a mock store before each test
    mockStore = {
      setEventsForCalendar: sandbox.stub(),
      loaded: false,
    } as any;
    // Stub the useCalendarStore function to always return our mock
    service = new EventService(mockStore);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should initialize a new event for a calendar', () => {
    // Arrange
    const calendar = new Calendar();
    calendar.id = 'cal123';

    // Act
    const result = service.initEvent(calendar);

    // Assert
    expect(result).toBeInstanceOf(CalendarEvent);
    expect(result.calendarId).toBe('cal123');
    expect(result.location).toBeDefined();
    expect(result.schedules.length).toBeGreaterThan(0);
  });
});

describe('loadCalendarEvents', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: ReturnType<typeof useEventStore>;
  let service: EventService;
  let mockListModels: sinon.SinonStub;

  beforeEach(() => {
    // Create a mock store before each test
    mockStore = {
      events: {},
      setEventsForCalendar: sandbox.stub(),
    } as any;

    // Stub the listModels method
    mockListModels = sandbox.stub(ModelService, 'listModels');

    // Create service with our mock store
    service = new EventService(mockStore);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should load events for a calendar and update the store', async () => {
    // Arrange
    const mockEvents = [
      { calendarId: 'c1', id: 'evt1', date: '2023-01-01' },
      { calendarId: 'c1', id: 'evt2', date: '2023-01-02' },
    ];
    mockListModels.resolves(ListResult.fromArray(mockEvents));

    // Act
    const result = await service.loadCalendarEvents('test-calendar');

    // Assert
    expect(mockListModels.calledWith('/api/v1/calendars/test-calendar/events')).toBe(true);
    expect(result.length).toBe(2);
    // Verify setEventsForCalendar was called with the calendar ID and events
    expect((mockStore.setEventsForCalendar as sinon.SinonStub).calledWith('c1')).toBe(true);
  });

  it('should throw an error when loading events fails', async () => {
    // Arrange
    mockListModels.rejects(new Error('API Error'));

    // Act & Assert
    await expect(service.loadCalendarEvents('test-calendar')).rejects.toThrow('API Error');
  });
});

describe('createEvent', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: ReturnType<typeof useEventStore>;
  let service: EventService;
  let mockCreateModel: sinon.SinonStub;
  let mockUpdateModel: sinon.SinonStub;

  beforeEach(() => {
    // Create a mock store before each test
    mockStore = {
      addEvent: sandbox.stub(),
      updateEvent: sandbox.stub(),
    } as any;

    // Stub the ModelService methods
    mockCreateModel = sandbox.stub(ModelService, 'createModel');
    mockUpdateModel = sandbox.stub(ModelService, 'updateModel');

    // Create service with our mock store
    service = new EventService(mockStore);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should create a new event when the event has no ID', async () => {
    // Arrange
    const event = new CalendarEvent();
    event.calendarId = 'cal123';
    // Set name in the event content
    const content = event.content('en');
    content.name = 'New Event';

    const mockCreatedEvent = {
      id: 'evt1',
      calendarId: 'cal123',
      content: {
        en: { name: 'New Event', description: '' },
      },
    };
    mockCreateModel.resolves(mockCreatedEvent);

    // Act
    const result = await service.saveEvent(event);

    // Assert
    expect(mockCreateModel.calledWith(event, '/api/v1/events')).toBe(true);
    expect(result).toBeInstanceOf(CalendarEvent);
    expect(result.id).toBe('evt1');
    // Verify addEvent was called with calendarId and event
    expect((mockStore.addEvent as sinon.SinonStub).calledWith('cal123', sinon.match.instanceOf(CalendarEvent))).toBe(true);
  });

  it('should update an existing event when the event has an ID', async () => {
    // Arrange
    const event = new CalendarEvent();
    event.id = 'evt1';
    event.calendarId = 'cal123';
    // Set name in the event content
    const content = event.content('en');
    content.name = 'Updated Event';

    const mockUpdatedEvent = {
      id: 'evt1',
      calendarId: 'cal123',
      content: {
        en: { name: 'Updated Event', description: '' },
      },
    };
    mockUpdateModel.resolves(mockUpdatedEvent);

    // Act
    const result = await service.saveEvent(event);

    // Assert
    expect(mockUpdateModel.calledWith(event, '/api/v1/events')).toBe(true);
    expect(result).toBeInstanceOf(CalendarEvent);
    expect(result.id).toBe('evt1');
    // Verify updateEvent was called with calendarId and event
    expect((mockStore.updateEvent as sinon.SinonStub).calledWith('cal123', sinon.match.instanceOf(CalendarEvent))).toBe(true);
  });

  it('should throw an error when the event has no calendarId', async () => {
    // Arrange
    const event = new CalendarEvent();
    // Set name in the event content
    const content = event.content('en');
    content.name = 'New Event';

    // Act & Assert
    await expect(service.saveEvent(event))
      .rejects.toThrow('Event must have a calendarId');
  });

  it('should throw an error when saving the event fails', async () => {
    // Arrange
    const event = new CalendarEvent();
    event.calendarId = 'cal123';

    mockCreateModel.rejects(new Error('API Error'));

    // Act & Assert
    await expect(service.saveEvent(event)).rejects.toThrow('API Error');
  });
});
