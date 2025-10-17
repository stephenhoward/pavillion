import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import { EventEntity, EventContentEntity } from '@/server/calendar/entity/event';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import EventService from '@/server/calendar/service/events';

describe('listEvents', () => {
  let service: EventService;
  let sandbox = sinon.createSandbox();

  beforeEach(() => {
    service = new EventService(new EventEmitter());
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
