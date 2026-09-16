import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import config from 'config';
import { EventEmitter } from 'events';
import EventInstanceService from '../../service/event_instance';
import { EventInstanceEntity } from '../../entity/event_instance';
import { EventEntity } from '../../entity/event';
import { EventRepostEntity } from '../../entity/event_repost';
import { CalendarEvent } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { DateTime } from 'luxon';
import type { EventSourceActor } from '@/server/activitypub/interface';

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
 * Builds the source-actor map the AP interface hands back. `pageUrl` null
 * models a peer whose actor document declared no usable `url`.
 */
function actorMap(entries: Array<[string, string, string | null]>): Map<string, EventSourceActor> {
  return new Map(entries.map(([eventId, actorUri, pageUrl]) => [eventId, { actorUri, pageUrl }]));
}

/**
 * Creates a mock ActivityPubInterface with the methods needed by both
 * EventInstanceService.listEventInstancesForCalendar and the helper it now
 * delegates the visible-id union to (EventService.listEventIdsForCalendar).
 */
function buildMockApInterface(sandbox: sinon.SinonSandbox, sourceActorMap: Map<string, EventSourceActor>): any {
  return {
    getEventSourceActors: sandbox.stub().resolves(sourceActorMap),
    // EventService.listEventIdsForCalendar uses this to enumerate AP-shared ids.
    getSharedEventStatusMap: sandbox.stub().resolves(new Map<string, 'auto' | 'manual'>()),
  };
}

/**
 * Stubs the upstream queries used by EventService.listEventIdsForCalendar so
 * the helper returns a known set of event ids without needing a real DB.
 * The set of event ids drives the `event_id IN (...)` filter in the rewritten
 * listEventInstancesForCalendar.
 */
function stubVisibleEventIds(sandbox: sinon.SinonSandbox, eventIds: string[]): void {
  sandbox.stub(EventEntity, 'findAll').resolves(
    eventIds.map(id => ({ id }) as any),
  );
  sandbox.stub(EventRepostEntity, 'findAll').resolves([]);
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
    it('should keep repostStatus="none" and set sourceCalendar=null for non-reposted events', async () => {
      const instanceEntity = buildMockInstanceEntity({
        instanceId: 'inst-1',
        instanceCalendarId: 'cal-A',
        eventId: 'evt-1',
        eventCalendarId: 'cal-A',
      });

      stubVisibleEventIds(sandbox, ['evt-1']);
      sandbox.stub(EventInstanceEntity, 'findAll').resolves([instanceEntity]);
      service.setActivityPubInterface(buildMockApInterface(sandbox, new Map()));

      const calendar: any = { id: 'cal-A' };
      const results = await service.listEventInstancesForCalendar(calendar);

      expect(results).toHaveLength(1);
      expect(results[0].event.repostStatus).toBe('none');
      expect(results[0].event.sourceCalendar).toBeNull();
    });

    it('should set repostStatus="manual" and populate sourceCalendar for local reposts', async () => {
      const instanceEntity = buildMockInstanceEntity({
        instanceId: 'inst-2',
        instanceCalendarId: 'cal-B',
        eventId: 'evt-2',
        eventCalendarId: 'cal-A',
        calendarUrlName: 'original-cal',
      });

      stubVisibleEventIds(sandbox, ['evt-2']);
      sandbox.stub(EventInstanceEntity, 'findAll').resolves([instanceEntity]);
      service.setActivityPubInterface(buildMockApInterface(sandbox, new Map()));

      const calendar: any = { id: 'cal-B' };
      const results = await service.listEventInstancesForCalendar(calendar);

      expect(results).toHaveLength(1);
      expect(results[0].event.repostStatus).toBe('manual');
      expect(results[0].event.sourceCalendar).not.toBeNull();
      expect(results[0].event.sourceCalendar!.urlName).toBe('original-cal');
      expect(results[0].event.sourceCalendar!.host).toBe(TEST_DOMAIN);
      expect(results[0].event.sourceCalendar!.url).toBe('/original-cal');
    });

    it('should populate sourceCalendar from the page URL the peer declared', async () => {
      const instanceEntity = buildMockInstanceEntity({
        instanceId: 'inst-3',
        instanceCalendarId: 'cal-B',
        eventId: 'evt-3',
        eventCalendarId: null,
      });

      stubVisibleEventIds(sandbox, ['evt-3']);
      sandbox.stub(EventInstanceEntity, 'findAll').resolves([instanceEntity]);

      service.setActivityPubInterface(buildMockApInterface(sandbox, actorMap([
        ['evt-3', 'https://remote.example.com/calendars/remote-cal', 'https://remote.example.com/remote-cal'],
      ])));

      const calendar: any = { id: 'cal-B' };
      const results = await service.listEventInstancesForCalendar(calendar);

      expect(results).toHaveLength(1);
      expect(results[0].event.repostStatus).toBe('manual');
      expect(results[0].event.sourceCalendar).not.toBeNull();
      expect(results[0].event.sourceCalendar!.urlName).toBe('remote-cal');
      expect(results[0].event.sourceCalendar!.host).toBe('remote.example.com');
      expect(results[0].event.sourceCalendar!.url).toBe('https://remote.example.com/remote-cal');
    });

    it('should fall back to the /view/ spelling when the peer declared no page URL', async () => {
      const instanceEntity = buildMockInstanceEntity({
        instanceId: 'inst-3b',
        instanceCalendarId: 'cal-B',
        eventId: 'evt-3b',
        eventCalendarId: null,
      });

      stubVisibleEventIds(sandbox, ['evt-3b']);
      sandbox.stub(EventInstanceEntity, 'findAll').resolves([instanceEntity]);

      service.setActivityPubInterface(buildMockApInterface(sandbox, actorMap([
        ['evt-3b', 'https://remote.example.com/calendars/remote-cal', null],
      ])));

      const calendar: any = { id: 'cal-B' };
      const results = await service.listEventInstancesForCalendar(calendar);

      expect(results).toHaveLength(1);
      expect(results[0].event.repostStatus).toBe('manual');
      expect(results[0].event.sourceCalendar!.url).toBe('https://remote.example.com/view/remote-cal');
    });

    /**
     * The page URL is peer-supplied text that becomes an anchor href on an
     * anonymous public page, so an off-host declaration must not survive the
     * trip through the service either.
     */
    it('should not render a page URL a peer declared on someone else\'s host', async () => {
      const instanceEntity = buildMockInstanceEntity({
        instanceId: 'inst-3c',
        instanceCalendarId: 'cal-B',
        eventId: 'evt-3c',
        eventCalendarId: null,
      });

      stubVisibleEventIds(sandbox, ['evt-3c']);
      sandbox.stub(EventInstanceEntity, 'findAll').resolves([instanceEntity]);

      service.setActivityPubInterface(buildMockApInterface(sandbox, actorMap([
        ['evt-3c', 'https://remote.example.com/calendars/remote-cal', 'https://phish.example/remote-cal'],
      ])));

      const calendar: any = { id: 'cal-B' };
      const results = await service.listEventInstancesForCalendar(calendar);

      expect(results[0].event.sourceCalendar!.url).toBe('https://remote.example.com/view/remote-cal');
      expect(results[0].event.sourceCalendar!.url).not.toContain('phish.example');
    });

    it('should gracefully handle remote repost with no entry in actor URI map', async () => {
      const instanceEntity = buildMockInstanceEntity({
        instanceId: 'inst-4',
        instanceCalendarId: 'cal-B',
        eventId: 'evt-4',
        eventCalendarId: null,
      });

      stubVisibleEventIds(sandbox, ['evt-4']);
      sandbox.stub(EventInstanceEntity, 'findAll').resolves([instanceEntity]);
      service.setActivityPubInterface(buildMockApInterface(sandbox, new Map()));

      const calendar: any = { id: 'cal-B' };
      const results = await service.listEventInstancesForCalendar(calendar);

      expect(results).toHaveLength(1);
      expect(results[0].event.repostStatus).toBe('manual');
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

      stubVisibleEventIds(sandbox, ['evt-5', 'evt-6', 'evt-7']);
      sandbox.stub(EventInstanceEntity, 'findAll').resolves([nonRepost, localRepost, remoteRepost]);

      service.setActivityPubInterface(buildMockApInterface(sandbox, actorMap([
        ['evt-7', 'https://other.example.org/calendars/other-cal', null],
      ])));

      const calendar: any = { id: 'cal-A' };
      const results = await service.listEventInstancesForCalendar(calendar);

      expect(results).toHaveLength(3);

      // Non-repost
      expect(results[0].event.repostStatus).toBe('none');
      expect(results[0].event.sourceCalendar).toBeNull();

      // Local repost
      expect(results[1].event.repostStatus).toBe('manual');
      expect(results[1].event.sourceCalendar!.urlName).toBe('source-cal');

      // Remote repost
      expect(results[2].event.repostStatus).toBe('manual');
      expect(results[2].event.sourceCalendar!.urlName).toBe('other-cal');
      expect(results[2].event.sourceCalendar!.host).toBe('other.example.org');
    });
  });

  // URL parsing edge cases are tested directly on parseAttributedToUri
  // in src/server/calendar/test/service/source_calendar.test.ts
});
