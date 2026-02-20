/**
 * Unit tests for category assignment during auto-repost in ProcessInboxService.
 *
 * These tests verify that checkAndPerformAutoRepost correctly:
 * 1. Reads source_categories from EventObjectEntity after SharedEventEntity is created
 * 2. Applies calendar_category_mappings to resolve local category IDs
 * 3. Creates EventCategoryAssignmentEntity records for mapped categories
 * 4. Proceeds without error when source_categories is null
 * 5. Proceeds without error when no mappings exist
 * 6. Proceeds without error when category assignment throws (failure-safe)
 *
 * All tests stub database entities to avoid real DB dependencies.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

// Mock the outbox helper to avoid DB writes from addToOutbox
vi.mock('@/server/activitypub/helper/outbox', () => ({
  addToOutbox: vi.fn().mockResolvedValue(undefined),
}));

import ProcessInboxService from '@/server/activitypub/service/inbox';
import { FollowingCalendarEntity, SharedEventEntity } from '@/server/activitypub/entity/activitypub';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { EventEmitter } from 'events';
import CalendarInterface from '@/server/calendar/interface';
import CreateActivity from '@/server/activitypub/model/action/create';
import CategoryMappingService from '@/server/calendar/service/category_mapping';

describe('ProcessInboxService - auto-repost category assignment', () => {
  let sandbox: sinon.SinonSandbox;
  let inboxService: ProcessInboxService;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let calendarInterface: CalendarInterface;

  const calendarBActorUri = 'https://remote.example.com/calendars/calendarb';
  const remoteCalendarActorId = uuidv4();
  const sourceCategoryId = '11111111-1111-1111-1111-111111111111';
  const localCategoryId = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);

    testCalendar = new Calendar('test-calendar-id', 'test-calendar');
    testCalendar.addContent('en', new CalendarContent('en'));
    testCalendar.content('en').title = 'Test Calendar';

    // Suppress console output during tests
    sandbox.stub(console, 'log');
    sandbox.stub(console, 'warn');
  });

  afterEach(() => {
    sandbox.restore();
    vi.clearAllMocks();
  });

  /**
   * Helper: set up common stubs for processCreateEvent to reach the auto-repost path.
   *
   * processCreateEvent calls EventObjectEntity.findOne once (duplicate check → null).
   * checkAndPerformAutoRepost calls EventObjectEntity.findOne again to retrieve
   * the stored event object. We use onFirstCall/onSecondCall to handle both calls.
   *
   * Returns the eventObjectRecord for assertions.
   */
  function setupCreateEventStubs(
    eventApId: string,
    localEventId: string,
    sourceCategories: Array<{ id: string }> | null,
  ) {
    // Stub isPersonActorUri → false (calendar actor)
    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(false);

    // Stub actorOwnsObject → true
    sandbox.stub(inboxService as any, 'actorOwnsObject').resolves(true);

    // Stub calendarInterface.addRemoteEvent
    sandbox.stub(calendarInterface, 'addRemoteEvent').resolves({
      id: localEventId,
      calendarId: null,
    } as any);

    // Build the event object record with source_categories
    const eventObjectRecord = {
      event_id: localEventId,
      ap_id: eventApId,
      attributed_to: calendarBActorUri,
      source_categories: sourceCategories,
    } as any;

    // processCreateEvent calls EventObjectEntity.findOne first (duplicate check → null).
    // checkAndPerformAutoRepost calls it again to retrieve the stored record.
    const findOneStub = sandbox.stub(EventObjectEntity, 'findOne');
    findOneStub.onFirstCall().resolves(null);
    findOneStub.resolves(eventObjectRecord);  // all subsequent calls return the record

    // Stub EventObjectEntity.findOrCreate → created=true, returns record with source_categories
    sandbox.stub(EventObjectEntity, 'findOrCreate').resolves([eventObjectRecord, true]);

    return eventObjectRecord;
  }

  /**
   * Helper: set up auto-repost stubs (CalendarActorEntity, FollowingCalendarEntity, SharedEventEntity).
   */
  function setupAutoRepostStubs(localEventId: string) {
    const remoteCalendarRecord = { id: remoteCalendarActorId } as any;

    // Stub remoteCalendarService.findOrCreateByActorUri
    sandbox.stub((inboxService as any).remoteCalendarService, 'findOrCreateByActorUri')
      .resolves(remoteCalendarRecord);

    // Stub FollowingCalendarEntity.findOne → follow with auto_repost_originals=true
    sandbox.stub(FollowingCalendarEntity, 'findOne').resolves({
      id: 'follow-id',
      calendar_id: testCalendar.id,
      calendar_actor_id: remoteCalendarActorId,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    } as any);

    // Stub SharedEventEntity.findOne (duplicate check → null = not shared yet)
    sandbox.stub(SharedEventEntity, 'findOne').resolves(null);

    // Stub SharedEventEntity.create (the actual auto-repost)
    sandbox.stub(SharedEventEntity, 'create').resolves({
      id: uuidv4(),
      event_id: localEventId,
      calendar_id: testCalendar.id,
      auto_posted: true,
    } as any);
  }

  describe('category assignment when mappings exist', () => {
    it('should create EventCategoryAssignmentEntity records for each mapped category', async () => {
      const eventApId = `https://remote.example.com/events/event-${uuidv4()}`;
      const localEventId = uuidv4();
      const sourceCategories = [{ id: sourceCategoryId }];

      setupCreateEventStubs(eventApId, localEventId, sourceCategories);
      setupAutoRepostStubs(localEventId);

      // Stub CategoryMappingService.applyMappings → returns local category ID
      sandbox.stub(CategoryMappingService.prototype, 'applyMappings').resolves([localCategoryId]);

      // Stub EventCategoryAssignmentEntity.bulkCreate to capture arguments
      const bulkCreateStub = sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').resolves([]);

      const eventObject = {
        id: eventApId,
        type: 'Event',
        attributedTo: calendarBActorUri,
        name: 'Test Event With Categories',
        categories: [
          `https://remote.example.com/api/public/v1/calendars/calendarb/categories/${sourceCategoryId}`,
        ],
      };

      const createActivity = new CreateActivity(calendarBActorUri, eventObject);
      await inboxService['processCreateEvent'](testCalendar, createActivity);

      // Assert: bulkCreate was called with the mapped category
      expect(bulkCreateStub.calledOnce).toBe(true);
      const callArgs = bulkCreateStub.firstCall.args[0] as Array<{ event_id: string; category_id: string }>;
      expect(callArgs).toHaveLength(1);
      expect(callArgs[0].event_id).toBe(localEventId);
      expect(callArgs[0].category_id).toBe(localCategoryId);
      // ignoreDuplicates should be set
      expect(bulkCreateStub.firstCall.args[1]).toEqual({ ignoreDuplicates: true });
    });

    it('should pass the correct calendarId and remoteCalendarActorId to applyMappings', async () => {
      const eventApId = `https://remote.example.com/events/event-${uuidv4()}`;
      const localEventId = uuidv4();
      const sourceCategories = [{ id: sourceCategoryId }];

      setupCreateEventStubs(eventApId, localEventId, sourceCategories);
      setupAutoRepostStubs(localEventId);

      const applyMappingsStub = sandbox.stub(CategoryMappingService.prototype, 'applyMappings').resolves([]);
      sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').resolves([]);

      const eventObject = {
        id: eventApId,
        type: 'Event',
        attributedTo: calendarBActorUri,
        name: 'Test Event',
        categories: [
          `https://remote.example.com/api/public/v1/calendars/calendarb/categories/${sourceCategoryId}`,
        ],
      };

      const createActivity = new CreateActivity(calendarBActorUri, eventObject);
      await inboxService['processCreateEvent'](testCalendar, createActivity);

      expect(applyMappingsStub.calledOnce).toBe(true);
      const [calendarId, actorId, categories] = applyMappingsStub.firstCall.args;
      expect(calendarId).toBe(testCalendar.id);
      expect(actorId).toBe(remoteCalendarActorId);
      expect(categories).toEqual([{ id: sourceCategoryId }]);
    });
  });

  describe('category assignment when source_categories is null', () => {
    it('should not call applyMappings when source_categories is null', async () => {
      const eventApId = `https://remote.example.com/events/event-${uuidv4()}`;
      const localEventId = uuidv4();

      setupCreateEventStubs(eventApId, localEventId, null);
      setupAutoRepostStubs(localEventId);

      const applyMappingsStub = sandbox.stub(CategoryMappingService.prototype, 'applyMappings').resolves([]);
      const bulkCreateStub = sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').resolves([]);

      const eventObject = {
        id: eventApId,
        type: 'Event',
        attributedTo: calendarBActorUri,
        name: 'Test Event Without Categories',
      };

      const createActivity = new CreateActivity(calendarBActorUri, eventObject);
      await inboxService['processCreateEvent'](testCalendar, createActivity);

      expect(applyMappingsStub.called).toBe(false);
      expect(bulkCreateStub.called).toBe(false);
    });
  });

  describe('category assignment when no mappings exist', () => {
    it('should not call bulkCreate when applyMappings returns empty array', async () => {
      const eventApId = `https://remote.example.com/events/event-${uuidv4()}`;
      const localEventId = uuidv4();
      const sourceCategories = [{ id: sourceCategoryId }];

      setupCreateEventStubs(eventApId, localEventId, sourceCategories);
      setupAutoRepostStubs(localEventId);

      // No mappings → applyMappings returns []
      sandbox.stub(CategoryMappingService.prototype, 'applyMappings').resolves([]);
      const bulkCreateStub = sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').resolves([]);

      const eventObject = {
        id: eventApId,
        type: 'Event',
        attributedTo: calendarBActorUri,
        name: 'Test Event No Mappings',
        categories: [
          `https://remote.example.com/api/public/v1/calendars/calendarb/categories/${sourceCategoryId}`,
        ],
      };

      const createActivity = new CreateActivity(calendarBActorUri, eventObject);
      await inboxService['processCreateEvent'](testCalendar, createActivity);

      expect(bulkCreateStub.called).toBe(false);
    });
  });

  describe('failure-safe behavior', () => {
    it('should not throw when applyMappings throws an error', async () => {
      const eventApId = `https://remote.example.com/events/event-${uuidv4()}`;
      const localEventId = uuidv4();
      const sourceCategories = [{ id: sourceCategoryId }];

      setupCreateEventStubs(eventApId, localEventId, sourceCategories);
      setupAutoRepostStubs(localEventId);

      sandbox.stub(CategoryMappingService.prototype, 'applyMappings').rejects(new Error('DB failure'));
      const bulkCreateStub = sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').resolves([]);

      const eventObject = {
        id: eventApId,
        type: 'Event',
        attributedTo: calendarBActorUri,
        name: 'Test Event Failure Safe',
        categories: [
          `https://remote.example.com/api/public/v1/calendars/calendarb/categories/${sourceCategoryId}`,
        ],
      };

      const createActivity = new CreateActivity(calendarBActorUri, eventObject);

      // Should not throw
      await expect(inboxService['processCreateEvent'](testCalendar, createActivity)).resolves.toBeDefined();

      // bulkCreate should not have been called (failure before we get there)
      expect(bulkCreateStub.called).toBe(false);
    });

    it('should not throw when bulkCreate throws an error', async () => {
      const eventApId = `https://remote.example.com/events/event-${uuidv4()}`;
      const localEventId = uuidv4();
      const sourceCategories = [{ id: sourceCategoryId }];

      setupCreateEventStubs(eventApId, localEventId, sourceCategories);
      setupAutoRepostStubs(localEventId);

      sandbox.stub(CategoryMappingService.prototype, 'applyMappings').resolves([localCategoryId]);
      sandbox.stub(EventCategoryAssignmentEntity, 'bulkCreate').rejects(new Error('DB error during bulkCreate'));

      const eventObject = {
        id: eventApId,
        type: 'Event',
        attributedTo: calendarBActorUri,
        name: 'Test Event BulkCreate Failure',
        categories: [
          `https://remote.example.com/api/public/v1/calendars/calendarb/categories/${sourceCategoryId}`,
        ],
      };

      const createActivity = new CreateActivity(calendarBActorUri, eventObject);

      // Should not throw despite bulkCreate failure
      await expect(inboxService['processCreateEvent'](testCalendar, createActivity)).resolves.toBeDefined();
    });

    it('should still create SharedEventEntity even when category assignment fails', async () => {
      const eventApId = `https://remote.example.com/events/event-${uuidv4()}`;
      const localEventId = uuidv4();
      const sourceCategories = [{ id: sourceCategoryId }];

      setupCreateEventStubs(eventApId, localEventId, sourceCategories);

      const remoteCalendarRecord = { id: remoteCalendarActorId } as any;
      sandbox.stub((inboxService as any).remoteCalendarService, 'findOrCreateByActorUri')
        .resolves(remoteCalendarRecord);

      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves({
        id: 'follow-id',
        calendar_id: testCalendar.id,
        calendar_actor_id: remoteCalendarActorId,
        auto_repost_originals: true,
        auto_repost_reposts: false,
      } as any);

      sandbox.stub(SharedEventEntity, 'findOne').resolves(null);

      const sharedEventCreateStub = sandbox.stub(SharedEventEntity, 'create').resolves({
        id: uuidv4(),
        event_id: localEventId,
        calendar_id: testCalendar.id,
        auto_posted: true,
      } as any);

      // Category mapping throws
      sandbox.stub(CategoryMappingService.prototype, 'applyMappings').rejects(new Error('mapping failure'));

      const eventObject = {
        id: eventApId,
        type: 'Event',
        attributedTo: calendarBActorUri,
        name: 'Test Event',
        categories: [
          `https://remote.example.com/api/public/v1/calendars/calendarb/categories/${sourceCategoryId}`,
        ],
      };

      const createActivity = new CreateActivity(calendarBActorUri, eventObject);
      await inboxService['processCreateEvent'](testCalendar, createActivity);

      // SharedEventEntity.create must have been called (auto-repost completed)
      expect(sharedEventCreateStub.calledOnce).toBe(true);
    });
  });
});
