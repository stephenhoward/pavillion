import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { EventEntity, EventContentEntity } from '@/server/calendar/entity/event';
import EventService from '@/server/calendar/service/events';

describe('listEvents', () => {
  let service: EventService;
  let sandbox = sinon.createSandbox();

  beforeEach(() => {
    service = new EventService();
  });
  afterEach(() => {
    sandbox.restore();
  });

  it('should return 0 events', async () => {
    let findEventsStub = sandbox.stub(EventEntity, 'findAll');
    findEventsStub.resolves([]);

    let events = await service.listEvents(new Account('id', 'testme', 'testme'));
    expect(events).toEqual([]);
  });

  it('should return 1 event', async () => {
    let findEventsStub = sandbox.stub(EventEntity, 'findAll');
    findEventsStub.resolves([new EventEntity()]);

    let events = await service.listEvents(new Account('id', 'testme', 'testme'));
    expect(events.length).toBe(1);
    expect(events[0].content("en").name).toBe('');
  });

  it('should return an event with content', async () => {
    let findEventsStub = sandbox.stub(EventEntity, 'findAll');
    let entity = EventEntity.build({ accountId: 'id' });
    entity.content = [ EventContentEntity.build({language: "en", name: "testName", description: "description"}) ];
    findEventsStub.resolves([entity]);

    let events = await service.listEvents(new Account('id', 'testme', 'testme'));
    expect(events[0].content("en").name).toBe('testName');
  });

});
