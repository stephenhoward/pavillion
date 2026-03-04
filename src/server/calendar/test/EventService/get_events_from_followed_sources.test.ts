import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { Op } from 'sequelize';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventEntity } from '@/server/calendar/entity/event';
import EventService from '@/server/calendar/service/events';

describe('EventService.getEventsFromFollowedSources', () => {
  let service: EventService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new EventService(new EventEmitter());
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns an empty array when no events are found', async () => {
    sandbox.stub(EventEntity, 'findAll').resolves([]);

    const calendar = new Calendar('test-calendar-id', 'testcal');
    const result = await service.getEventsFromFollowedSources(calendar);

    expect(result).toEqual([]);
  });

  it('returns CalendarEvent domain models (not raw entities)', async () => {
    const entityId = 'aaaaaaaa-0000-0000-0000-000000000001';
    const sourceCalendarId = 'source-calendar-id';

    const mockEntity = EventEntity.build({
      id: entityId,
      calendar_id: sourceCalendarId,
    });
    // Simulate no loaded associations
    (mockEntity as any).schedules = [];
    (mockEntity as any).content = [];
    (mockEntity as any).location = null;
    (mockEntity as any).getDataValue = (_key: string) => [];

    sandbox.stub(EventEntity, 'findAll').resolves([mockEntity] as any);

    const calendar = new Calendar('consumer-id', 'consumer');
    const result = await service.getEventsFromFollowedSources(calendar);

    expect(result).toHaveLength(1);
    // Must be a CalendarEvent, not a raw entity
    expect(result[0]).toBeInstanceOf(CalendarEvent);
    expect(result[0].id).toBe(entityId);
    expect(result[0].calendarId).toBe(sourceCalendarId);
  });

  it('returns CalendarEvent with null calendarId for remote events', async () => {
    const remoteEventId = 'bbbbbbbb-0000-0000-0000-000000000001';

    const mockEntity = EventEntity.build({
      id: remoteEventId,
      calendar_id: null,
    });
    (mockEntity as any).schedules = [];
    (mockEntity as any).content = [];
    (mockEntity as any).location = null;
    (mockEntity as any).getDataValue = (_key: string) => [];

    sandbox.stub(EventEntity, 'findAll').resolves([mockEntity] as any);

    const calendar = new Calendar('consumer-id', 'consumer');
    const result = await service.getEventsFromFollowedSources(calendar);

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(CalendarEvent);
    expect(result[0].calendarId).toBeNull();
  });

  it('uses escaped calendar ID in the SQL query (SQL injection defense)', async () => {
    // Use a calendar ID that contains a SQL single-quote metacharacter.
    const maliciousId = "'; DROP TABLE events; --";
    const maliciousCalendar = new Calendar(maliciousId, 'malicious');

    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves([]);

    await service.getEventsFromFollowedSources(maliciousCalendar);

    const queryOptions = findAllStub.firstCall.args[0] as any;
    const orConditions = queryOptions.where[Op.or];

    // Extract the raw SQL from all three literal objects
    const remoteOriginalsLiteral: string = orConditions[0].id[Op.in].val;
    const remoteAnnouncementsLiteral: string = orConditions[1].id[Op.in].val;
    const localLiteral: string = orConditions[2].calendar_id[Op.in].val;

    // The unescaped injection pattern must NOT appear in any literal
    const unescapedPattern = `= '${maliciousId}`;
    expect(remoteOriginalsLiteral).not.toContain(unescapedPattern);
    expect(remoteAnnouncementsLiteral).not.toContain(unescapedPattern);
    expect(localLiteral).not.toContain(unescapedPattern);

    // The escaped form must be present (sequelize.escape wraps and escapes the value)
    const escapedValue = EventEntity.sequelize!.escape(maliciousId);
    expect(remoteOriginalsLiteral).toContain(`= ${escapedValue}`);
    expect(remoteAnnouncementsLiteral).toContain(`= ${escapedValue}`);
    expect(localLiteral).toContain(`= ${escapedValue}`);
  });

  it('builds the correct three-condition OR query for followed sources', async () => {
    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves([]);

    const calendar = new Calendar('test-id', 'testcal');
    await service.getEventsFromFollowedSources(calendar);

    const queryOptions = findAllStub.firstCall.args[0] as any;

    // Verify the where clause uses Op.or with three conditions
    expect(queryOptions.where).toBeDefined();
    expect(queryOptions.where[Op.or]).toBeDefined();
    expect(Array.isArray(queryOptions.where[Op.or])).toBe(true);
    expect(queryOptions.where[Op.or].length).toBe(3);

    // First condition: remote events authored by followed remote calendars (calendar_id = null)
    const remoteOriginalsCondition = queryOptions.where[Op.or][0];
    expect(remoteOriginalsCondition.calendar_id).toBeNull();
    expect(remoteOriginalsCondition.id[Op.in]).toBeDefined();

    // Second condition: remote events announced/shared by followed remote calendars
    const remoteAnnouncementsCondition = queryOptions.where[Op.or][1];
    expect(remoteAnnouncementsCondition.calendar_id).toBeNull();
    expect(remoteAnnouncementsCondition.id[Op.in]).toBeDefined();

    // Third condition: local events from followed local calendars
    const localCondition = queryOptions.where[Op.or][2];
    expect(localCondition.calendar_id[Op.in]).toBeDefined();
  });

  it('respects pagination parameters (page and pageSize)', async () => {
    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves([]);

    const calendar = new Calendar('test-id', 'testcal');
    await service.getEventsFromFollowedSources(calendar, 2, 10);

    const queryOptions = findAllStub.firstCall.args[0] as any;
    expect(queryOptions.limit).toBe(10);
    expect(queryOptions.offset).toBe(20); // page 2 * pageSize 10
  });

  it('orders results by createdAt DESC', async () => {
    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves([]);

    const calendar = new Calendar('test-id', 'testcal');
    await service.getEventsFromFollowedSources(calendar);

    const queryOptions = findAllStub.firstCall.args[0] as any;
    expect(queryOptions.order).toBeDefined();
    expect(queryOptions.order[0][0]).toBe('createdAt');
    expect(queryOptions.order[0][1]).toBe('DESC');
  });

  it('populates schedules from entity association', async () => {
    const eventId = 'cccccccc-0000-0000-0000-000000000001';

    const mockEntity = EventEntity.build({ id: eventId, calendar_id: 'cal-id' });

    // Simulate a loaded schedule entity with a toModel() method
    const mockScheduleModel = { id: 'sched-1', startDate: null, endDate: null };
    const mockScheduleEntity = {
      toModel: () => mockScheduleModel,
    };
    (mockEntity as any).schedules = [mockScheduleEntity];
    (mockEntity as any).content = [];
    (mockEntity as any).location = null;
    (mockEntity as any).getDataValue = (_key: string) => [];

    sandbox.stub(EventEntity, 'findAll').resolves([mockEntity] as any);

    const calendar = new Calendar('consumer-id', 'consumer');
    const result = await service.getEventsFromFollowedSources(calendar);

    expect(result).toHaveLength(1);
    expect(result[0].schedules).toHaveLength(1);
    expect(result[0].schedules[0]).toBe(mockScheduleModel);
  });

  it('populates categories from categoryAssignments', async () => {
    const eventId = 'dddddddd-0000-0000-0000-000000000001';
    const categoryId = 'cat-uuid-1';

    const mockEntity = EventEntity.build({ id: eventId, calendar_id: 'cal-id' });
    (mockEntity as any).schedules = [];
    (mockEntity as any).content = [];
    (mockEntity as any).location = null;
    // Simulate getDataValue returning categoryAssignments
    (mockEntity as any).getDataValue = (key: string) => {
      if (key === 'categoryAssignments') {
        return [{ category_id: categoryId }];
      }
      return [];
    };

    sandbox.stub(EventEntity, 'findAll').resolves([mockEntity] as any);

    const calendar = new Calendar('consumer-id', 'consumer');
    const result = await service.getEventsFromFollowedSources(calendar);

    expect(result).toHaveLength(1);
    expect(result[0].categories).toHaveLength(1);
    expect(result[0].categories[0].id).toBe(categoryId);
  });
});
