import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import config from 'config';
import { EventEmitter } from 'events';
import EventInstanceService from '../../service/event_instance';
import { EventInstanceEntity } from '../../entity/event_instance';
import { CalendarEvent } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { DateTime } from 'luxon';

const TEST_DOMAIN: string = config.get('domain');

/**
 * Helper to build a mock EventInstanceEntity with the necessary nested structure.
 */
function buildMockInstanceEntity(overrides: {
  instanceId: string;
  instanceCalendarId: string;
  eventId: string;
  eventCalendarId: string | null;
  calendarUrlName?: string;
  startTime?: Date;
}): any {
  const startTime = overrides.startTime ?? new Date('2026-04-15T10:00:00Z');

  const eventEntity: any = {
    id: overrides.eventId,
    calendar_id: overrides.eventCalendarId,
    event_source_url: null,
    content: [],
    location: null,
    media: null,
    calendar: overrides.calendarUrlName
      ? { url_name: overrides.calendarUrlName }
      : undefined,
    getDataValue: (key: string) => {
      if (key === 'categoryAssignments') return [];
      if (key === 'isRecurring') return false;
      if (key === 'schedules') return [];
      return undefined;
    },
    toModel: () => {
      return new CalendarEvent(overrides.eventId, overrides.eventCalendarId);
    },
  };

  return {
    id: overrides.instanceId,
    calendar_id: overrides.instanceCalendarId,
    event_id: overrides.eventId,
    start_time: startTime,
    end_time: null,
    event: eventEntity,
    toModel: () => {
      const event = new CalendarEvent(overrides.eventId, overrides.eventCalendarId);
      return new CalendarEventInstance(
        overrides.instanceId,
        event,
        DateTime.fromJSDate(startTime, { zone: 'utc' }),
        null,
      );
    },
  };
}

/**
 * Creates a mock ActivityPubInterface with getEventSourceActorUris stubbed.
 */
function buildMockApInterface(sandbox: sinon.SinonSandbox, uriMap: Map<string, string>): any {
  return {
    getEventSourceActorUris: sandbox.stub().resolves(uriMap),
  };
}

describe('EventInstanceService sourceCalendar resolution', () => {
  let sandbox: sinon.SinonSandbox;
  let service: EventInstanceService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new EventInstanceService(new EventEmitter());
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('resolveSourceCalendars (via listEventInstancesForCalendar)', () => {
    it('should set isRepost=false and sourceCalendar=null for non-reposted events', async () => {
      const instanceEntity = buildMockInstanceEntity({
        instanceId: 'inst-1',
        instanceCalendarId: 'cal-A',
        eventId: 'evt-1',
        eventCalendarId: 'cal-A',
      });

      sandbox.stub(EventInstanceEntity, 'findAll').resolves([instanceEntity]);
      service.setActivityPubInterface(buildMockApInterface(sandbox, new Map()));

      const calendar: any = { id: 'cal-A' };
      const results = await service.listEventInstancesForCalendar(calendar);

      expect(results).toHaveLength(1);
      expect(results[0].event.isRepost).toBe(false);
      expect(results[0].event.sourceCalendar).toBeNull();
    });

    it('should set isRepost=true and populate sourceCalendar for local reposts', async () => {
      const instanceEntity = buildMockInstanceEntity({
        instanceId: 'inst-2',
        instanceCalendarId: 'cal-B',
        eventId: 'evt-2',
        eventCalendarId: 'cal-A',
        calendarUrlName: 'original-cal',
      });

      sandbox.stub(EventInstanceEntity, 'findAll').resolves([instanceEntity]);
      service.setActivityPubInterface(buildMockApInterface(sandbox, new Map()));

      const calendar: any = { id: 'cal-B' };
      const results = await service.listEventInstancesForCalendar(calendar);

      expect(results).toHaveLength(1);
      expect(results[0].event.isRepost).toBe(true);
      expect(results[0].event.sourceCalendar).not.toBeNull();
      expect(results[0].event.sourceCalendar!.urlName).toBe('original-cal');
      expect(results[0].event.sourceCalendar!.host).toBe(TEST_DOMAIN);
      expect(results[0].event.sourceCalendar!.url).toBe('/view/original-cal');
    });

    it('should set isRepost=true and populate sourceCalendar for remote reposts', async () => {
      const instanceEntity = buildMockInstanceEntity({
        instanceId: 'inst-3',
        instanceCalendarId: 'cal-B',
        eventId: 'evt-3',
        eventCalendarId: null,
      });

      sandbox.stub(EventInstanceEntity, 'findAll').resolves([instanceEntity]);

      const uriMap = new Map<string, string>([
        ['evt-3', 'https://remote.example.com/calendars/remote-cal'],
      ]);
      service.setActivityPubInterface(buildMockApInterface(sandbox, uriMap));

      const calendar: any = { id: 'cal-B' };
      const results = await service.listEventInstancesForCalendar(calendar);

      expect(results).toHaveLength(1);
      expect(results[0].event.isRepost).toBe(true);
      expect(results[0].event.sourceCalendar).not.toBeNull();
      expect(results[0].event.sourceCalendar!.urlName).toBe('remote-cal');
      expect(results[0].event.sourceCalendar!.host).toBe('remote.example.com');
      expect(results[0].event.sourceCalendar!.url).toBe('https://remote.example.com/view/remote-cal');
    });

    it('should gracefully handle remote repost with no entry in actor URI map', async () => {
      const instanceEntity = buildMockInstanceEntity({
        instanceId: 'inst-4',
        instanceCalendarId: 'cal-B',
        eventId: 'evt-4',
        eventCalendarId: null,
      });

      sandbox.stub(EventInstanceEntity, 'findAll').resolves([instanceEntity]);
      service.setActivityPubInterface(buildMockApInterface(sandbox, new Map()));

      const calendar: any = { id: 'cal-B' };
      const results = await service.listEventInstancesForCalendar(calendar);

      expect(results).toHaveLength(1);
      expect(results[0].event.isRepost).toBe(true);
      expect(results[0].event.sourceCalendar).toBeNull();
    });

    it('should handle mixed repost and non-repost instances in a single batch', async () => {
      const nonRepost = buildMockInstanceEntity({
        instanceId: 'inst-5',
        instanceCalendarId: 'cal-A',
        eventId: 'evt-5',
        eventCalendarId: 'cal-A',
      });
      const localRepost = buildMockInstanceEntity({
        instanceId: 'inst-6',
        instanceCalendarId: 'cal-A',
        eventId: 'evt-6',
        eventCalendarId: 'cal-C',
        calendarUrlName: 'source-cal',
      });
      const remoteRepost = buildMockInstanceEntity({
        instanceId: 'inst-7',
        instanceCalendarId: 'cal-A',
        eventId: 'evt-7',
        eventCalendarId: null,
      });

      sandbox.stub(EventInstanceEntity, 'findAll').resolves([nonRepost, localRepost, remoteRepost]);

      const uriMap = new Map<string, string>([
        ['evt-7', 'https://other.example.org/calendars/other-cal'],
      ]);
      service.setActivityPubInterface(buildMockApInterface(sandbox, uriMap));

      const calendar: any = { id: 'cal-A' };
      const results = await service.listEventInstancesForCalendar(calendar);

      expect(results).toHaveLength(3);

      // Non-repost
      expect(results[0].event.isRepost).toBe(false);
      expect(results[0].event.sourceCalendar).toBeNull();

      // Local repost
      expect(results[1].event.isRepost).toBe(true);
      expect(results[1].event.sourceCalendar!.urlName).toBe('source-cal');

      // Remote repost
      expect(results[2].event.isRepost).toBe(true);
      expect(results[2].event.sourceCalendar!.urlName).toBe('other-cal');
      expect(results[2].event.sourceCalendar!.host).toBe('other.example.org');
    });
  });

  // URL parsing edge cases are tested directly on parseAttributedToUri
  // in src/server/calendar/test/service/source_calendar.test.ts
});
