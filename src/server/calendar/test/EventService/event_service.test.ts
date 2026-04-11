import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import { EventEntity, EventContentEntity } from '@/server/calendar/entity/event';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { EventRepostEntity } from '@/server/calendar/entity/event_repost';
import EventService from '@/server/calendar/service/events';

/**
 * Creates a mock ActivityPubInterface with getSharedEventIds and
 * getSharedEventStatusMap stubbed.
 *
 * @param sharedEventIds - Array of event IDs reposted to the calendar.
 * @param statusOverrides - Optional map of eventId -> 'auto'|'manual' to
 *   control the repostStatus resolution. Any id in sharedEventIds not in
 *   statusOverrides defaults to 'manual'.
 */
function buildMockApInterface(
  sharedEventIds: string[] = [],
  statusOverrides: Record<string, 'auto' | 'manual'> = {},
) {
  const statusMap = new Map<string, 'auto' | 'manual'>();
  for (const id of sharedEventIds) {
    statusMap.set(id, statusOverrides[id] ?? 'manual');
  }
  return {
    getSharedEventIds: sinon.stub().resolves(sharedEventIds),
    getSharedEventStatusMap: sinon.stub().resolves(statusMap),
  } as any;
}

describe('listEvents', () => {
  let service: EventService;
  let sandbox = sinon.createSandbox();

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    service.setActivityPubInterface(buildMockApInterface());
    // Stub EventRepostEntity.findAll to return empty array (no reposts)
    sandbox.stub(EventRepostEntity, 'findAll').resolves([]);
  });
  afterEach(() => {
    sandbox.restore();
  });

  it('should return 0 events', async () => {
    let findEventsStub = sandbox.stub(EventEntity, 'findAll');
    findEventsStub.resolves([]);

    let events = await service.listEvents(new Calendar('id', 'testme'));
    expect(events).toEqual([]);
  });

  it('should return 1 event', async () => {
    let findEventsStub = sandbox.stub(EventEntity, 'findAll');
    findEventsStub.resolves([new EventEntity()]);

    let events = await service.listEvents(new Calendar('id', 'testme'));
    expect(events.length).toBe(1);
    expect(events[0].content("en").name).toBe('');
  });

  it('should return an event with content', async () => {
    let findEventsStub = sandbox.stub(EventEntity, 'findAll');
    let entity = EventEntity.build({ accountId: 'id' });
    entity.content = [ EventContentEntity.build({language: "en", name: "testName", description: "description"}) ];
    findEventsStub.resolves([entity]);

    let events = await service.listEvents(new Calendar('id', 'testme'));
    expect(events[0].content("en").name).toBe('testName');
  });

  describe('isRepost flag', () => {
    it('should mark events as isRepost=false when they are owned by the calendar', async () => {
      const entity = EventEntity.build({ id: 'owned-event-id', calendar_id: 'cal-id' });
      sandbox.stub(EventEntity, 'findAll').resolves([entity]);

      const events = await service.listEvents(new Calendar('cal-id', 'testcal'));
      expect(events[0].isRepost).toBe(false);
    });

    it('should mark events as isRepost=true when they are in EventRepostEntity', async () => {
      (EventRepostEntity.findAll as sinon.SinonStub).resolves([
        { event_id: 'reposted-event-id' },
      ]);
      const entity = EventEntity.build({ id: 'reposted-event-id' });
      sandbox.stub(EventEntity, 'findAll').resolves([entity]);

      const events = await service.listEvents(new Calendar('cal-id', 'testcal'));
      expect(events[0].isRepost).toBe(true);
    });

    it('should mark events as isRepost=true when they are in SharedEventEntity (auto-repost)', async () => {
      const autoRepostId = '550e8400-e29b-41d4-a716-446655440000';
      // Provide shared event IDs via the mock AP interface
      service.setActivityPubInterface(buildMockApInterface([autoRepostId]));

      const entity = EventEntity.build({ id: autoRepostId });
      sandbox.stub(EventEntity, 'findAll').resolves([entity]);

      const events = await service.listEvents(new Calendar('cal-id', 'testcal'));
      expect(events[0].isRepost).toBe(true);
    });

    it('should correctly distinguish owned and reposted events in the same result', async () => {
      (EventRepostEntity.findAll as sinon.SinonStub).resolves([
        { event_id: 'reposted-id' },
      ]);
      const ownedEntity = EventEntity.build({ id: 'owned-id', calendar_id: 'cal-id' });
      const repostedEntity = EventEntity.build({ id: 'reposted-id' });
      sandbox.stub(EventEntity, 'findAll').resolves([ownedEntity, repostedEntity]);

      const events = await service.listEvents(new Calendar('cal-id', 'testcal'));
      const owned = events.find(e => e.id === 'owned-id');
      const reposted = events.find(e => e.id === 'reposted-id');
      expect(owned?.isRepost).toBe(false);
      expect(reposted?.isRepost).toBe(true);
    });
  });

  describe('repostStatus field', () => {
    it('should set repostStatus="none" for events owned by the calendar', async () => {
      const entity = EventEntity.build({ id: 'owned-event-id', calendar_id: 'cal-id' });
      sandbox.stub(EventEntity, 'findAll').resolves([entity]);

      const events = await service.listEvents(new Calendar('cal-id', 'testcal'));
      expect(events[0].repostStatus).toBe('none');
      expect(events[0].isRepost).toBe(false);
    });

    it('should set repostStatus="manual" for events shared with auto_posted=false', async () => {
      const manualRepostId = '550e8400-e29b-41d4-a716-446655440001';
      service.setActivityPubInterface(
        buildMockApInterface([manualRepostId], { [manualRepostId]: 'manual' }),
      );

      const entity = EventEntity.build({ id: manualRepostId });
      sandbox.stub(EventEntity, 'findAll').resolves([entity]);

      const events = await service.listEvents(new Calendar('cal-id', 'testcal'));
      expect(events[0].repostStatus).toBe('manual');
      expect(events[0].isRepost).toBe(true);
    });

    it('should set repostStatus="auto" for events shared with auto_posted=true', async () => {
      const autoRepostId = '550e8400-e29b-41d4-a716-446655440002';
      service.setActivityPubInterface(
        buildMockApInterface([autoRepostId], { [autoRepostId]: 'auto' }),
      );

      const entity = EventEntity.build({ id: autoRepostId });
      sandbox.stub(EventEntity, 'findAll').resolves([entity]);

      const events = await service.listEvents(new Calendar('cal-id', 'testcal'));
      expect(events[0].repostStatus).toBe('auto');
      expect(events[0].isRepost).toBe(true);
    });

    it('should prefer SharedEventEntity status over legacy EventRepostEntity', async () => {
      // An event present in both EventRepostEntity and SharedEventEntity
      // should use the SharedEventEntity status (auto in this case).
      const eventId = '550e8400-e29b-41d4-a716-446655440003';
      (EventRepostEntity.findAll as sinon.SinonStub).resolves([
        { event_id: eventId },
      ]);
      service.setActivityPubInterface(
        buildMockApInterface([eventId], { [eventId]: 'auto' }),
      );

      const entity = EventEntity.build({ id: eventId });
      sandbox.stub(EventEntity, 'findAll').resolves([entity]);

      const events = await service.listEvents(new Calendar('cal-id', 'testcal'));
      expect(events[0].repostStatus).toBe('auto');
    });

    it('should default legacy EventRepostEntity-only events to "manual"', async () => {
      const legacyId = 'legacy-repost-id';
      (EventRepostEntity.findAll as sinon.SinonStub).resolves([
        { event_id: legacyId },
      ]);

      const entity = EventEntity.build({ id: legacyId });
      sandbox.stub(EventEntity, 'findAll').resolves([entity]);

      const events = await service.listEvents(new Calendar('cal-id', 'testcal'));
      expect(events[0].repostStatus).toBe('manual');
      expect(events[0].isRepost).toBe(true);
    });

    it('should resolve repost status via a single SharedEventEntity query (no N+1)', async () => {
      // Verify the map is built once up front, not per-event.
      const id1 = '550e8400-e29b-41d4-a716-446655440010';
      const id2 = '550e8400-e29b-41d4-a716-446655440011';
      const id3 = '550e8400-e29b-41d4-a716-446655440012';
      const apMock = buildMockApInterface([id1, id2, id3], {
        [id1]: 'auto',
        [id2]: 'manual',
        [id3]: 'auto',
      });
      service.setActivityPubInterface(apMock);

      const entities = [
        EventEntity.build({ id: id1 }),
        EventEntity.build({ id: id2 }),
        EventEntity.build({ id: id3 }),
      ];
      sandbox.stub(EventEntity, 'findAll').resolves(entities);

      const events = await service.listEvents(new Calendar('cal-id', 'testcal'));

      // getSharedEventStatusMap called exactly once regardless of event count
      expect(apMock.getSharedEventStatusMap.callCount).toBe(1);
      expect(events.map(e => e.repostStatus).sort()).toEqual(['auto', 'auto', 'manual']);
    });
  });

  describe('listEvents with search and filter options', () => {
    it('should pass search parameter to database query', async () => {
      let findEventsStub = sandbox.stub(EventEntity, 'findAll');
      findEventsStub.resolves([]);

      await service.listEvents(new Calendar('cal-id', 'testcal'), {
        search: 'concert',
      });

      expect(findEventsStub.calledOnce).toBe(true);
      const queryOptions = findEventsStub.firstCall.args[0];

      // The search should add an include for EventContentEntity with where clause
      expect(queryOptions.include).toBeDefined();
      const contentInclude = queryOptions.include.find((inc: any) => inc.model === EventContentEntity);
      expect(contentInclude).toBeDefined();
      expect(contentInclude.where).toBeDefined();
    });

    it('should pass category filter to database query', async () => {
      let findEventsStub = sandbox.stub(EventEntity, 'findAll');
      findEventsStub.resolves([]);

      await service.listEvents(new Calendar('cal-id', 'testcal'), {
        categories: ['category-1', 'category-2'],
      });

      expect(findEventsStub.calledOnce).toBe(true);
      const queryOptions = findEventsStub.firstCall.args[0];

      // Category filtering should add include for EventCategoryAssignmentEntity
      expect(queryOptions.include).toBeDefined();
      const categoryInclude = queryOptions.include.find((inc: any) => inc.model === EventCategoryAssignmentEntity);
      expect(categoryInclude).toBeDefined();
      expect(categoryInclude.where).toBeDefined();
      // Check that category_id condition exists (it will be a Sequelize operator object)
      expect(categoryInclude.where.category_id).toBeDefined();
      expect(typeof categoryInclude.where.category_id).toBe('object');
    });


    it('should combine search and category filter', async () => {
      let findEventsStub = sandbox.stub(EventEntity, 'findAll');
      findEventsStub.resolves([]);

      await service.listEvents(new Calendar('cal-id', 'testcal'), {
        search: 'conference',
        categories: ['tech', 'business'],
      });

      expect(findEventsStub.calledOnce).toBe(true);
      const queryOptions = findEventsStub.firstCall.args[0];

      // Should have both content and category includes
      expect(queryOptions.include).toBeDefined();
      expect(queryOptions.include.length).toBeGreaterThanOrEqual(2);
    });


    it('should handle empty category filter gracefully', async () => {
      let findEventsStub = sandbox.stub(EventEntity, 'findAll');
      findEventsStub.resolves([]);

      await service.listEvents(new Calendar('cal-id', 'testcal'), {
        categories: [],
      });

      expect(findEventsStub.calledOnce).toBe(true);
      const queryOptions = findEventsStub.firstCall.args[0];

      // With eager loading, category assignments are always included, but no where clause should be added
      const categoryInclude = queryOptions.include?.find((inc: any) => inc.model === EventCategoryAssignmentEntity);
      expect(categoryInclude).toBeDefined();
      expect(categoryInclude.where).toBeUndefined();
      expect(categoryInclude.required).toBeUndefined();
    });
  });

});
