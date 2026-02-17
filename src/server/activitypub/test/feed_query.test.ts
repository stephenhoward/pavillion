import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import config from 'config';
import { Op } from 'sequelize';
import ActivityPubService from '@/server/activitypub/service/members';
import { Calendar } from '@/common/model/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { FollowingCalendarEntity, SharedEventEntity } from '@/server/activitypub/entity/activitypub';
import { setupActivityPubSchema, teardownActivityPubSchema } from '@/server/test/helpers/database';

describe('ActivityPubService - getFeed with EventObjectEntity Join', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ActivityPubService;
  let calendar: Calendar;

  beforeEach(async () => {
    // Setup ephemeral ActivityPub database schema
    await setupActivityPubSchema();

    sandbox = sinon.createSandbox();
    service = new ActivityPubService();
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

  it('should order results by createdAt DESC', async () => {
    const mockEvents = [
      EventEntity.build({
        id: 'event-uuid-newer',
        calendar_id: null,
        event_source_url: 'https://remote.example.com/events/newer',
        createdAt: new Date('2026-01-15'),
      }),
      EventEntity.build({
        id: 'event-uuid-older',
        calendar_id: null,
        event_source_url: 'https://remote.example.com/events/older',
        createdAt: new Date('2026-01-10'),
      }),
    ];

    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves(mockEvents);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);

    const result = await service.getFeed(calendar, 0, 20);

    // Verify ordering parameter
    const queryOptions = findAllStub.firstCall.args[0] as any;
    expect(queryOptions.order).toBeDefined();
    expect(queryOptions.order[0][0]).toBe('createdAt');
    expect(queryOptions.order[0][1]).toBe('DESC');
  });
});
