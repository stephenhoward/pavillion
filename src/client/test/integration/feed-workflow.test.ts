import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';
import axios from 'axios';
import { useFeedStore } from '@/client/stores/feedStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';

/**
 * Integration tests for critical feed workflows
 * These tests verify end-to-end scenarios and integration points
 */
describe('Feed Workflow Integration Tests', () => {
  let sandbox: sinon.SinonSandbox;
  let axiosGetStub: sinon.SinonStub;
  let axiosPostStub: sinon.SinonStub;
  let axiosDeleteStub: sinon.SinonStub;
  let consoleErrorStub: sinon.SinonStub;

  beforeEach(() => {
    setActivePinia(createPinia());
    sandbox = sinon.createSandbox();

    axiosGetStub = sandbox.stub(axios, 'get');
    axiosPostStub = sandbox.stub(axios, 'post');
    axiosDeleteStub = sandbox.stub(axios, 'delete');

    // Suppress console.error during tests
    consoleErrorStub = sandbox.stub(console, 'error');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('End-to-end: Follow calendar -> events appear in feed', () => {
    it('should show events in feed after following a remote calendar', async () => {
      const feedStore = useFeedStore();
      const calendarStore = useCalendarStore();

      // Setup: User has a calendar
      const calendar = new Calendar('local-cal-1', 'my-calendar');
      calendarStore.setCalendars([calendar]);
      feedStore.setSelectedCalendar('local-cal-1');

      // Mock follow calendar API call
      axiosPostStub.withArgs('/api/v1/social/follows').resolves({
        data: { success: true },
      });

      // Mock getting follows (after follow completes) with boolean fields
      axiosGetStub.withArgs(sinon.match(/\/api\/v1\/social\/follows/)).resolves({
        data: [
          {
            id: 'follow-1',
            remoteCalendarId: 'remote@example.com',
            calendarId: 'local-cal-1',
            autoRepostOriginals: false,
            autoRepostReposts: false,
          },
        ],
      });

      // Mock feed events from the followed calendar
      const mockEventData = {
        id: 'remote-event-1',
        calendarId: 'remote-cal-id',
        date: '2025-12-27',
        content: {
          en: {
            language: 'en',
            name: 'Remote Event',
            description: 'Event from followed calendar',
          },
        },
        repostStatus: 'none',
      };

      axiosGetStub.withArgs(sinon.match(/\/api\/v1\/social\/feed/)).resolves({
        data: {
          events: [mockEventData],
          hasMore: false,
        },
      });

      // Action: Follow a calendar with boolean fields (defaults to false, false)
      await feedStore.followCalendar('remote@example.com');

      // Verify: Calendar is in follows list
      expect(feedStore.follows).toHaveLength(1);
      expect(feedStore.follows[0].remoteCalendarId).toBe('remote@example.com');

      // Action: Load feed
      await feedStore.loadFeed();

      // Verify: Events from followed calendar appear
      expect(feedStore.events).toHaveLength(1);
      expect(feedStore.events[0].id).toBe('remote-event-1');
      expect(feedStore.events[0].content('en')?.name).toBe('Remote Event');
    });
  });

  describe('End-to-end: Repost event -> appears in calendar', () => {
    it('should change repost status after reposting an event', async () => {
      const feedStore = useFeedStore();
      feedStore.setSelectedCalendar('local-cal-1');

      // Setup: Event in feed that hasn't been reposted
      const mockEvent = CalendarEvent.fromObject({
        id: 'event-1',
        calendarId: 'remote-cal',
        date: '2025-12-27',
        content: {
          en: {
            language: 'en',
            name: 'Test Event',
            description: 'Description',
          },
        },
      });

      feedStore.events = [Object.assign(mockEvent, { repostStatus: 'none' as const })];

      // Mock share event API call
      axiosPostStub.withArgs('/api/v1/social/shares').resolves({
        data: { id: 'share-1', calendarId: 'local-cal-1', eventId: 'event-1' },
      });

      // Action: Repost the event
      await feedStore.repostEvent('event-1');

      // Verify: Event status changed to 'manual'
      expect(feedStore.events[0].repostStatus).toBe('manual');
    });
  });

  describe('Integration: Calendar selector change resets feed state', () => {
    it('should clear feed data when switching calendars', async () => {
      const feedStore = useFeedStore();
      const calendarStore = useCalendarStore();

      // Setup: User has multiple calendars
      const calendar1 = new Calendar('cal-1', 'calendar-1');
      const calendar2 = new Calendar('cal-2', 'calendar-2');
      calendarStore.setCalendars([calendar1, calendar2]);

      feedStore.setSelectedCalendar('cal-1');

      // Populate feed data for calendar 1 with boolean fields
      feedStore.events = [
        { id: 'event-1', title: 'Event 1', repostStatus: 'none' },
      ];
      feedStore.follows = [
        {
          id: 'follow-1',
          remoteCalendarId: 'remote@example.com',
          calendarId: 'cal-1',
          autoRepostOriginals: false,
          autoRepostReposts: false,
        },
      ];
      feedStore.eventsPage = 2;

      // Mock API calls for calendar 2
      axiosGetStub.withArgs(sinon.match(/calendarId=cal-2/)).resolves({
        data: [],
      });

      // Action: Switch to calendar 2
      feedStore.setSelectedCalendar('cal-2');

      // Verify: Feed state was reset
      expect(feedStore.events).toEqual([]);
      expect(feedStore.follows).toEqual([]);
      expect(feedStore.eventsPage).toBe(0);
    });
  });

  describe('Integration: Infinite scroll pagination works correctly', () => {
    it('should append new events when loading more pages', async () => {
      const feedStore = useFeedStore();
      feedStore.setSelectedCalendar('cal-1');

      // Setup: First page of events
      const firstPageEvents = [
        {
          id: 'event-1',
          calendarId: 'remote-cal',
          date: '2025-12-27',
          content: { en: { language: 'en', name: 'Event 1', description: 'Desc 1' } },
          repostStatus: 'none',
        },
      ];

      axiosGetStub.withArgs(sinon.match(/page=0/)).resolves({
        data: {
          events: firstPageEvents,
          hasMore: true,
        },
      });

      await feedStore.loadFeed();

      expect(feedStore.events).toHaveLength(1);
      expect(feedStore.eventsPage).toBe(0);
      expect(feedStore.eventsHasMore).toBe(true);

      // Setup: Second page of events
      const secondPageEvents = [
        {
          id: 'event-2',
          calendarId: 'remote-cal',
          date: '2025-12-28',
          content: { en: { language: 'en', name: 'Event 2', description: 'Desc 2' } },
          repostStatus: 'none',
        },
      ];

      axiosGetStub.withArgs(sinon.match(/page=1/)).resolves({
        data: {
          events: secondPageEvents,
          hasMore: false,
        },
      });

      // Action: Load more events
      await feedStore.loadFeed(true);

      // Verify: Events were appended
      expect(feedStore.events).toHaveLength(2);
      expect(feedStore.events[0].id).toBe('event-1');
      expect(feedStore.events[1].id).toBe('event-2');
      expect(feedStore.eventsPage).toBe(1);
      expect(feedStore.eventsHasMore).toBe(false);
    });

    it('should handle empty page when no more events available', async () => {
      const feedStore = useFeedStore();
      feedStore.setSelectedCalendar('cal-1');

      // Mock empty response
      axiosGetStub.withArgs(sinon.match(/\/api\/v1\/social\/feed/)).resolves({
        data: {
          events: [],
          hasMore: false,
        },
      });

      // Action: Load feed
      await feedStore.loadFeed(true);

      // Verify: hasMore is false
      expect(feedStore.eventsHasMore).toBe(false);
    });
  });

  describe('Error handling: Network failure during API calls', () => {
    it('should handle network error during feed loading', async () => {
      const feedStore = useFeedStore();
      feedStore.setSelectedCalendar('cal-1');

      // Mock network error
      axiosGetStub.withArgs(sinon.match(/\/api\/v1\/social\/feed/)).rejects(
        new Error('Network error'),
      );

      // Action: Try to load feed
      await expect(feedStore.loadFeed()).rejects.toThrow('Network error');

      // Verify: Loading state was cleared
      expect(feedStore.loading.events).toBe(false);

      // Verify: Error was logged
      expect(consoleErrorStub.calledWith('Error loading feed:')).toBe(true);
    });

    it('should handle error during follow calendar action', async () => {
      const feedStore = useFeedStore();
      feedStore.setSelectedCalendar('cal-1');

      // Mock API error
      axiosPostStub.withArgs('/api/v1/social/follows').rejects(
        new Error('Failed to follow calendar'),
      );

      // Mock the getFollows call that happens during followCalendar
      axiosGetStub.withArgs(sinon.match(/\/api\/v1\/social\/follows/)).rejects(
        new Error('Failed to follow calendar'),
      );

      // Action: Try to follow calendar with boolean fields (defaults)
      await expect(
        feedStore.followCalendar('remote@example.com'),
      ).rejects.toThrow();
    });

    it('should rollback optimistic update on repost error', async () => {
      const feedStore = useFeedStore();
      feedStore.setSelectedCalendar('cal-1');

      const mockEvent = CalendarEvent.fromObject({
        id: 'event-1',
        calendarId: 'remote-cal',
        date: '2025-12-27',
        content: { en: { language: 'en', name: 'Test Event', description: 'Desc' } },
      });

      feedStore.events = [Object.assign(mockEvent, { repostStatus: 'none' as const })];

      // Mock API error
      axiosPostStub.withArgs('/api/v1/social/shares').rejects(
        new Error('Failed to repost'),
      );

      // Action: Try to repost - FeedService wraps errors in UnknownError
      await expect(feedStore.repostEvent('event-1')).rejects.toThrow();

      // Verify: Status was rolled back to original
      expect(feedStore.events[0].repostStatus).toBe('none');

      // Verify: Error was logged
      expect(consoleErrorStub.calledWith('Error reposting event:')).toBe(true);
    });
  });

  describe('Edge case: Un-repost auto-posted event, then manually repost', () => {
    it('should change auto-posted event to manual repost after un-repost and re-repost', async () => {
      const feedStore = useFeedStore();
      feedStore.setSelectedCalendar('cal-1');

      // Setup: Auto-posted event in feed
      const mockEvent = CalendarEvent.fromObject({
        id: 'event-1',
        calendarId: 'remote-cal',
        date: '2025-12-27',
        content: { en: { language: 'en', name: 'Auto Event', description: 'Auto posted' } },
      });

      feedStore.events = [Object.assign(mockEvent, { repostStatus: 'auto' as const })];

      // Mock unshare (un-repost) API call
      axiosDeleteStub.withArgs(sinon.match(/\/api\/v1\/social\/share/)).resolves({
        data: { success: true },
      });

      // Action 1: Un-repost the auto-posted event
      await feedStore.unrepostEvent('event-1');

      // Verify: Status changed to 'none'
      expect(feedStore.events[0].repostStatus).toBe('none');

      // Mock share (manual repost) API call
      axiosPostStub.withArgs('/api/v1/social/shares').resolves({
        data: { id: 'share-2', calendarId: 'local-cal-1', eventId: 'event-1' },
      });

      // Action 2: Manually repost the event
      await feedStore.repostEvent('event-1');

      // Verify: Status changed to 'manual' (not 'auto')
      expect(feedStore.events[0].repostStatus).toBe('manual');
    });
  });

  describe('Integration: Follow policy update affects auto-repost behavior', () => {
    it('should update follow policy with boolean fields and persist change', async () => {
      const feedStore = useFeedStore();
      feedStore.setSelectedCalendar('cal-1');

      // Setup with boolean fields (both false initially)
      feedStore.follows = [
        {
          id: 'follow-1',
          remoteCalendarId: 'remote@example.com',
          calendarId: 'cal-1',
          autoRepostOriginals: false,
          autoRepostReposts: false,
        },
      ];

      // Mock update policy API (uses PATCH with boolean fields)
      const axiosPatchStub = sandbox.stub(axios, 'patch');
      axiosPatchStub.withArgs('/api/v1/social/follows/follow-1').resolves({
        data: {
          id: 'follow-1',
          remoteCalendarId: 'remote@example.com',
          calendarId: 'cal-1',
          autoRepostOriginals: true,
          autoRepostReposts: true,
        },
      });

      // Action: Update policy to enable both auto-repost settings
      await feedStore.updateFollowPolicy('follow-1', true, true);

      // Verify: Policy was updated in store with boolean fields
      expect(feedStore.follows[0].autoRepostOriginals).toBe(true);
      expect(feedStore.follows[0].autoRepostReposts).toBe(true);
    });
  });

  describe('Integration: Empty feed after unfollowing all calendars', () => {
    it('should show empty feed after unfollowing the only followed calendar', async () => {
      const feedStore = useFeedStore();
      feedStore.setSelectedCalendar('cal-1');

      // Setup: Following one calendar with events in feed (using boolean fields)
      feedStore.follows = [
        {
          id: 'follow-1',
          remoteCalendarId: 'remote@example.com',
          calendarId: 'cal-1',
          autoRepostOriginals: false,
          autoRepostReposts: false,
        },
      ];

      feedStore.events = [
        { id: 'event-1', title: 'Event 1', repostStatus: 'none' },
      ];

      // Mock unfollow API
      axiosDeleteStub.withArgs(sinon.match(/\/api\/v1\/social\/follows/)).resolves({
        data: { success: true },
      });

      // Mock empty follows after unfollow
      axiosGetStub.withArgs(sinon.match(/\/api\/v1\/social\/follows/)).resolves({
        data: [],
      });

      // Mock empty feed after unfollow
      axiosGetStub.withArgs(sinon.match(/\/api\/v1\/social\/feed/)).resolves({
        data: {
          events: [],
          hasMore: false,
        },
      });

      // Action: Unfollow the calendar
      await feedStore.unfollowCalendar('follow-1');

      // Verify: Calendar removed from follows
      expect(feedStore.follows).toHaveLength(0);

      // Action: Reload feed
      await feedStore.loadFeed();

      // Verify: Feed is now empty
      expect(feedStore.events).toHaveLength(0);
    });
  });
});
