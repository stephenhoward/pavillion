import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import { EventEntity, EventContentEntity } from '@/server/calendar/entity/event';
import { LocationEntity } from '@/server/calendar/entity/location';
import { MediaEntity } from '@/server/media/entity/media';
import EventService from '@/server/calendar/service/events';
import CalendarService from '@/server/calendar/service/calendar';
import { EventNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';

describe('EventService.duplicateEvent', () => {
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

  it('should duplicate event with new title successfully', async () => {
    // Arrange
    const originalEventId = 'original-event-id';
    const newTitle = 'Duplicated Event Title';
    const calendarId = 'calendar1';

    // Mock original event entity with full data
    const originalEventEntity = EventEntity.build({
      id: originalEventId,
      calendar_id: calendarId,
      account_id: 'test-account-id',
      event_source_url: '/test-calendar/original-event-id',
      location_id: 'location1',
      media_id: 'media1',
    });

    // Mock event content
    const originalContent = [
      EventContentEntity.build({
        id: 'content1',
        event_id: originalEventId,
        language: 'en',
        name: 'Original Event Name',
        description: 'Original description',
      }),
    ];

    // Mock location
    const originalLocation = LocationEntity.build({
      id: 'location1',
      calendar_id: calendarId,
      name: 'Test Venue',
      address: '123 Test St',
    });

    // Mock media
    const originalMedia = MediaEntity.build({
      id: 'media1',
      calendar_id: calendarId,
      filename: 'test-image.jpg',
    });

    // Set up entity relationships
    originalEventEntity.content = originalContent;
    originalEventEntity.location = originalLocation;
    originalEventEntity.media = originalMedia;

    // Stub database calls
    const findEventStub = sandbox.stub(EventEntity, 'findOne');
    findEventStub.resolves(originalEventEntity);

    const calendarServiceStub = sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser');
    calendarServiceStub.resolves([new Calendar(calendarId, 'test-calendar')]);

    // Mock event creation
    const createEventStub = sandbox.stub(service, 'createEvent');
    const duplicatedEvent = new CalendarEvent('new-event-id', 'test-calendar');
    duplicatedEvent.addContent(new CalendarEventContent('en', newTitle, 'Original description'));
    createEventStub.resolves(duplicatedEvent);

    // Act
    const result = await service.duplicateEvent(mockAccount, originalEventId, { title: newTitle });

    // Assert
    expect(result.success).toBe(true);
    expect(result.originalEventId).toBe(originalEventId);
    expect(result.duplicatedEvent).toBeDefined();
    expect(createEventStub.calledOnce).toBe(true);

    // Verify the create event was called with correct parameters
    const createEventArgs = createEventStub.getCall(0).args[1];
    expect(createEventArgs.calendarId).toBe(calendarId);
    expect(createEventArgs.content.en.name).toBe(newTitle);
    expect(createEventArgs.content.en.description).toBe('Original description');
    expect(createEventArgs.location).toEqual({
      name: 'Test Venue',
      address: '123 Test St',
      city: '',
      state: '',
      postalCode: '',
      country: '',
    });
    expect(createEventArgs.mediaId).toBe('media1');
    expect(createEventArgs.schedules).toEqual([]);
  });

  it('should duplicate event without new title (use original)', async () => {
    // Arrange
    const originalEventId = 'original-event-id';
    const calendarId = 'calendar1';

    const originalEventEntity = EventEntity.build({
      id: originalEventId,
      calendar_id: calendarId,
      account_id: 'test-account-id',
    });

    const originalContent = [
      EventContentEntity.build({
        id: 'content1',
        event_id: originalEventId,
        language: 'en',
        name: 'Original Event Name',
        description: 'Original description',
      }),
    ];

    originalEventEntity.content = originalContent;

    const findEventStub = sandbox.stub(EventEntity, 'findOne');
    findEventStub.resolves(originalEventEntity);

    const calendarServiceStub = sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser');
    calendarServiceStub.resolves([new Calendar(calendarId, 'test-calendar')]);

    const createEventStub = sandbox.stub(service, 'createEvent');
    const duplicatedEvent = new CalendarEvent('new-event-id', 'test-calendar');
    duplicatedEvent.addContent(new CalendarEventContent('en', 'Copy of Original Event Name', 'Original description'));
    createEventStub.resolves(duplicatedEvent);

    // Act
    const result = await service.duplicateEvent(mockAccount, originalEventId, {});

    // Assert
    expect(result.success).toBe(true);
    expect(createEventStub.calledOnce).toBe(true);

    const createEventArgs = createEventStub.getCall(0).args[1];
    expect(createEventArgs.content.en.name).toBe('Copy of Original Event Name');
  });

  it('should handle event not found error', async () => {
    // Arrange
    const nonexistentEventId = 'nonexistent-event-id';

    const findEventStub = sandbox.stub(EventEntity, 'findOne');
    findEventStub.resolves(null);

    // Act & Assert
    await expect(service.duplicateEvent(mockAccount, nonexistentEventId, { title: 'New Title' }))
      .rejects.toThrow(EventNotFoundError);
  });

  it('should handle insufficient permissions error', async () => {
    // Arrange
    const originalEventId = 'original-event-id';
    const calendarId = 'calendar1';

    const originalEventEntity = EventEntity.build({
      id: originalEventId,
      calendar_id: calendarId,
      account_id: 'other-account-id',
    });

    const findEventStub = sandbox.stub(EventEntity, 'findOne');
    findEventStub.resolves(originalEventEntity);

    // Mock user has no access to this calendar
    const calendarServiceStub = sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser');
    calendarServiceStub.resolves([]);

    // Act & Assert
    await expect(service.duplicateEvent(mockAccount, originalEventId, { title: 'New Title' }))
      .rejects.toThrow(InsufficientCalendarPermissionsError);
  });

  it('should handle multiple content languages', async () => {
    // Arrange
    const originalEventId = 'original-event-id';
    const newTitle = 'Duplicated Event';
    const calendarId = 'calendar1';

    const originalEventEntity = EventEntity.build({
      id: originalEventId,
      calendar_id: calendarId,
      account_id: 'test-account-id',
    });

    const originalContent = [
      EventContentEntity.build({
        id: 'content1',
        event_id: originalEventId,
        language: 'en',
        name: 'Original Event Name',
        description: 'Original description',
      }),
      EventContentEntity.build({
        id: 'content2',
        event_id: originalEventId,
        language: 'es',
        name: 'Nombre del Evento Original',
        description: 'Descripción original',
      }),
    ];

    originalEventEntity.content = originalContent;

    const findEventStub = sandbox.stub(EventEntity, 'findOne');
    findEventStub.resolves(originalEventEntity);

    const calendarServiceStub = sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser');
    calendarServiceStub.resolves([new Calendar(calendarId, 'test-calendar')]);

    const createEventStub = sandbox.stub(service, 'createEvent');
    const duplicatedEvent = new CalendarEvent('new-event-id', 'test-calendar');
    createEventStub.resolves(duplicatedEvent);

    // Act
    await service.duplicateEvent(mockAccount, originalEventId, { title: newTitle });

    // Assert
    const createEventArgs = createEventStub.getCall(0).args[1];
    expect(createEventArgs.content.en.name).toBe(newTitle);
    expect(createEventArgs.content.en.description).toBe('Original description');
    expect(createEventArgs.content.es.name).toBe(newTitle);
    expect(createEventArgs.content.es.description).toBe('Descripción original');
  });

  it('should exclude schedules and categories from duplication', async () => {
    // Arrange
    const originalEventId = 'original-event-id';
    const calendarId = 'calendar1';

    const originalEventEntity = EventEntity.build({
      id: originalEventId,
      calendar_id: calendarId,
      account_id: 'test-account-id',
    });

    const originalContent = [
      EventContentEntity.build({
        id: 'content1',
        event_id: originalEventId,
        language: 'en',
        name: 'Original Event Name',
        description: 'Original description',
      }),
    ];

    originalEventEntity.content = originalContent;

    const findEventStub = sandbox.stub(EventEntity, 'findOne');
    findEventStub.resolves(originalEventEntity);

    const calendarServiceStub = sandbox.stub(CalendarService.prototype, 'editableCalendarsForUser');
    calendarServiceStub.resolves([new Calendar(calendarId, 'test-calendar')]);

    const createEventStub = sandbox.stub(service, 'createEvent');
    const duplicatedEvent = new CalendarEvent('new-event-id', 'test-calendar');
    createEventStub.resolves(duplicatedEvent);

    // Act
    await service.duplicateEvent(mockAccount, originalEventId, { title: 'New Title' });

    // Assert
    const createEventArgs = createEventStub.getCall(0).args[1];
    expect(createEventArgs.schedules).toEqual([]);
    // Categories are not copied (would be empty in the new event)
  });
});
