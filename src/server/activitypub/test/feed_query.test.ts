import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import config from 'config';
import ActivityPubService from '@/server/activitypub/service/members';
import { Calendar } from '@/common/model/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { FollowingCalendarEntity, SharedEventEntity } from '@/server/activitypub/entity/activitypub';
import { setupActivityPubSchema, teardownActivityPubSchema } from './helpers/database';

describe('ActivityPubService - getFeed with AP Identifier Join', () => {
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
    const domain = config.get('domain');
    const remoteCalendarId = 'https://remote.example.com/o/remotecalendar';

    // Mock events from a followed calendar
    const mockEvents = [
      EventEntity.build({
        id: 'https://remote.example.com/events/event-1',
        calendar_id: remoteCalendarId,
        event_source_url: '/remotecalendar/event-1',
        createdAt: new Date('2026-01-10'),
      }),
      EventEntity.build({
        id: 'https://remote.example.com/events/event-2',
        calendar_id: remoteCalendarId,
        event_source_url: '/remotecalendar/event-2',
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
    expect(result[0].calendar_id).toBe(remoteCalendarId);
  });

  it('should return empty array when calendar has no follows', async () => {
    // Stub findAll to return empty array (no events from followed calendars)
    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves([]);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);

    const result = await service.getFeed(calendar, 0, 20);

    expect(findAllStub.calledOnce).toBe(true);
    expect(result).toEqual([]);
  });

  it('should correctly join via calendar_id = remote_calendar_id', async () => {
    const remoteCalendarId = 'https://remote.example.com/o/calendar1';

    const mockEvents = [
      EventEntity.build({
        id: 'https://remote.example.com/events/test',
        calendar_id: remoteCalendarId,
        event_source_url: '/calendar1/test',
        createdAt: new Date('2026-01-12'),
      }),
    ];

    const findAllStub = sandbox.stub(EventEntity, 'findAll').resolves(mockEvents);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([]);

    await service.getFeed(calendar, 0, 20);

    // Verify the query uses a subquery for the join
    const queryOptions = findAllStub.firstCall.args[0] as any;

    // Check that the where clause uses a subquery for the join
    expect(queryOptions.where).toBeDefined();
    expect(queryOptions.where.calendar_id).toBeDefined();
  });

  it('should order results by createdAt DESC', async () => {
    const remoteCalendarId = 'https://remote.example.com/o/calendar2';

    const mockEvents = [
      EventEntity.build({
        id: 'https://remote.example.com/events/newer',
        calendar_id: remoteCalendarId,
        event_source_url: '/calendar2/newer',
        createdAt: new Date('2026-01-15'),
      }),
      EventEntity.build({
        id: 'https://remote.example.com/events/older',
        calendar_id: remoteCalendarId,
        event_source_url: '/calendar2/older',
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
