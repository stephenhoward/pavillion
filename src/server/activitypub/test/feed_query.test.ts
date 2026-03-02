import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import config from 'config';
import { Op } from 'sequelize';
import ActivityPubService from '@/server/activitypub/service/members';
import { Calendar } from '@/common/model/calendar';
import { EventEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import { FollowingCalendarEntity, SharedEventEntity } from '@/server/activitypub/entity/activitypub';
import { setupActivityPubSchema, teardownActivityPubSchema } from '@/server/test/helpers/database';
import { EventEmitter } from 'events';
import CalendarInterface from '@/server/calendar/interface';

describe('ActivityPubService - getFeed with EventObjectEntity Join', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ActivityPubService;
  let calendar: Calendar;

  beforeEach(async () => {
    // Setup ephemeral ActivityPub database schema
    await setupActivityPubSchema();

    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    service = new ActivityPubService(eventBus, new CalendarInterface(eventBus));
    calendar = new Calendar('local-calendar-id', 'localcalendar');
  });

  afterEach(async () => {
    sandbox.restore();

    // Teardown ephemeral database schema
    await teardownActivityPubSchema();
  });

  it('should return events from followed calendars only', async () => {
    // Remote events have null calendar_id
    const mockEvents = [
      EventEntity.build({
        id: 'event-uuid-1',
        calendar_id: null,
        event_source_url: 'https://remote.example.com/events/event-1',
        createdAt: new Date('2026-01-10'),
      }),
      EventEntity.build({
        id: 'event-uuid-2',
        calendar_id: null,
        event_source_url: 'https://remote.example.com/events/event-2',
        createdAt: new Date('2026-01-11'),
      }),
    ];

    // Stub the queries
    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves(mockEvents);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);

    const result = await service.getFeed(calendar, 0, 20);

    // Verify the query was called
    expect(findAllStub.calledOnce).toBe(true);

    // Verify results include events from followed calendar
    expect(result.length).toBe(2);
    // Remote events have null calendar_id
    expect(result[0].calendar_id).toBeNull();
  });

  it('should return empty array when calendar has no follows', async () => {
    // Stub findAll to return empty array (no events from followed calendars)
    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves([]);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);

    const result = await service.getFeed(calendar, 0, 20);

    expect(findAllStub.calledOnce).toBe(true);
    expect(result).toEqual([]);
  });

  it('should query using EventObjectEntity join for remote events', async () => {
    const mockEvents = [
      EventEntity.build({
        id: 'event-uuid-3',
        calendar_id: null,
        event_source_url: 'https://remote.example.com/events/test',
        createdAt: new Date('2026-01-12'),
      }),
    ];

    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves(mockEvents);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);

    await service.getFeed(calendar, 0, 20);

    // Verify the query structure for the new design
    const queryOptions = findAllStub.firstCall.args[0] as any;

    // Check that the where clause uses Op.or with remote (originals), remote (announcements), and local conditions
    expect(queryOptions.where).toBeDefined();
    expect(queryOptions.where[Op.or]).toBeDefined();
    expect(Array.isArray(queryOptions.where[Op.or])).toBe(true);
    expect(queryOptions.where[Op.or].length).toBe(3);

    // First condition: remote events originally authored by followed remote calendars (calendar_id = null)
    const remoteOriginalsCondition = queryOptions.where[Op.or][0];
    expect(remoteOriginalsCondition.calendar_id).toBeNull();
    expect(remoteOriginalsCondition.id).toBeDefined();
    expect(remoteOriginalsCondition.id[Op.in]).toBeDefined();

    // Second condition: remote events announced/shared by followed remote calendars (calendar_id = null)
    const remoteAnnouncementsCondition = queryOptions.where[Op.or][1];
    expect(remoteAnnouncementsCondition.calendar_id).toBeNull();
    expect(remoteAnnouncementsCondition.id).toBeDefined();
    expect(remoteAnnouncementsCondition.id[Op.in]).toBeDefined();

    // Third condition: local events from followed local calendars
    const localCondition = queryOptions.where[Op.or][2];
    expect(localCondition.calendar_id).toBeDefined();
    expect(localCondition.calendar_id[Op.in]).toBeDefined();
  });

  it('should order results by schedule start_date ASC', async () => {
    const mockEvents = [
      EventEntity.build({
        id: 'event-uuid-earlier',
        calendar_id: null,
        event_source_url: 'https://remote.example.com/events/earlier',
      }),
      EventEntity.build({
        id: 'event-uuid-later',
        calendar_id: null,
        event_source_url: 'https://remote.example.com/events/later',
      }),
    ];

    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves(mockEvents);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);

    const result = await service.getFeed(calendar, 0, 20);

    // Verify ordering parameter uses schedule start_date ascending (chronological order)
    const queryOptions = findAllStub.firstCall.args[0] as any;
    expect(queryOptions.order).toBeDefined();
    expect(queryOptions.order[0][0]).toMatchObject({ model: EventScheduleEntity, as: 'schedules' });
    expect(queryOptions.order[0][1]).toBe('start_date');
    expect(queryOptions.order[0][2]).toBe('ASC');
  });

  it('should use sequelize.escape() for calendar.id in all three literal subqueries (defense-in-depth)', async () => {
    // Use a calendar ID that contains a SQL single-quote metacharacter.
    // With direct interpolation: WHERE f.calendar_id = ''; DROP TABLE events; --'
    // With escape():            WHERE f.calendar_id = '''; DROP TABLE events; --'
    // The escaped form has an extra leading quote (SQLite doubles internal quotes).
    const maliciousId = "'; DROP TABLE events; --";
    const maliciousCalendar = new Calendar(maliciousId, 'malicious');

    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves([]);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);

    await service.getFeed(maliciousCalendar, 0, 20);

    const queryOptions = findAllStub.firstCall.args[0] as any;
    const orConditions = queryOptions.where[Op.or];

    // Extract the raw SQL from all three literal objects
    const remoteOriginalsLiteral: string = orConditions[0].id[Op.in].val;
    const remoteAnnouncementsLiteral: string = orConditions[1].id[Op.in].val;
    const localLiteral: string = orConditions[2].calendar_id[Op.in].val;

    // With direct string interpolation the SQL would be:
    //   WHERE f.calendar_id = ''; DROP TABLE events; --'
    // The escape() function doubles the quote, producing:
    //   WHERE f.calendar_id = '''; DROP TABLE events; --'
    // Verify the unescaped injection pattern is NOT present in any literal.
    const unescapedPattern = `= '${maliciousId}`;
    expect(remoteOriginalsLiteral).not.toContain(unescapedPattern);
    expect(remoteAnnouncementsLiteral).not.toContain(unescapedPattern);
    expect(localLiteral).not.toContain(unescapedPattern);

    // Verify the escaped form IS present (sequelize.escape wraps and escapes the value)
    const escapedValue = EventEntity.sequelize!.escape(maliciousId);
    expect(remoteOriginalsLiteral).toContain(`= ${escapedValue}`);
    expect(remoteAnnouncementsLiteral).toContain(`= ${escapedValue}`);
    expect(localLiteral).toContain(`= ${escapedValue}`);
  });
});
