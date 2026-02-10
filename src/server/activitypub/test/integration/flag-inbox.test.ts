import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import CalendarInterface from '@/server/calendar/interface';
import ModerationInterface from '@/server/moderation/interface';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { ReportStatus } from '@/common/model/report';
import type { ReporterType } from '@/common/model/report';

describe('ProcessInboxService - Flag Activity Processing', () => {
  let inboxService: ProcessInboxService;
  let calendarInterface: CalendarInterface;
  let moderationInterface: ModerationInterface;
  let eventBus: EventEmitter;
  let testCalendar: Calendar;
  let testEvent: CalendarEvent;

  beforeEach(async () => {
    eventBus = new EventEmitter();

    // Create test calendar and event
    testCalendar = new Calendar(uuidv4(), 'test-calendar');
    testEvent = new CalendarEvent(uuidv4());
    testEvent.calendarId = testCalendar.id;
    testEvent.title = 'Test Event';

    // Mock CalendarInterface
    calendarInterface = {
      getCalendar: vi.fn().mockResolvedValue(testCalendar),
      getEventById: vi.fn().mockResolvedValue(testEvent),
    } as any;

    // Mock ModerationInterface
    moderationInterface = {
      receiveRemoteReport: vi.fn().mockResolvedValue({
        id: uuidv4(),
        eventId: testEvent.id,
        calendarId: testCalendar.id,
        category: 'spam',
        description: 'Test report',
        reporterType: 'federation' as ReporterType,
        status: ReportStatus.SUBMITTED,
        forwardedFromInstance: 'remote.instance',
        forwardedReportId: 'https://remote.instance/flags/uuid',
      }),
    } as any;

    inboxService = new ProcessInboxService(eventBus, calendarInterface, moderationInterface);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('processFlagActivity', () => {
    it('should process a valid Flag activity', async () => {
      const flagActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Flag',
        id: 'https://remote.instance/flags/test-flag-uuid',
        actor: 'https://remote.instance/calendars/reporter-calendar',
        object: `https://local.instance/events/${testEvent.id}`,
        content: 'This event contains spam',
        tag: [
          { type: 'Hashtag', name: '#spam' },
        ],
        summary: 'Event report: spam',
        published: '2026-02-07T12:00:00Z',
      };

      await inboxService.processFlagActivity(testCalendar, flagActivity);

      // Verify report was created
      expect(moderationInterface.receiveRemoteReport).toHaveBeenCalledWith({
        eventId: testEvent.id,
        category: 'spam',
        description: 'This event contains spam',
        forwardedFromInstance: 'remote.instance',
        forwardedReportId: 'https://remote.instance/flags/test-flag-uuid',
      });
    });

    it('should extract category from hashtag', async () => {
      const flagActivity = {
        type: 'Flag',
        id: 'https://remote.instance/flags/test-uuid',
        actor: 'https://remote.instance/calendars/reporter',
        object: `https://local.instance/events/${testEvent.id}`,
        content: 'Misleading information',
        tag: [
          { type: 'Hashtag', name: '#misleading' },
        ],
        published: '2026-02-07T12:00:00Z',
      };

      await inboxService.processFlagActivity(testCalendar, flagActivity);

      expect(moderationInterface.receiveRemoteReport).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'misleading',
        }),
      );
    });

    it('should default to "other" category if no valid hashtag found', async () => {
      const flagActivity = {
        type: 'Flag',
        id: 'https://remote.instance/flags/test-uuid',
        actor: 'https://remote.instance/calendars/reporter',
        object: `https://local.instance/events/${testEvent.id}`,
        content: 'Problem with event',
        tag: [],
        published: '2026-02-07T12:00:00Z',
      };

      await inboxService.processFlagActivity(testCalendar, flagActivity);

      expect(moderationInterface.receiveRemoteReport).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'other',
        }),
      );
    });

    it('should extract domain from actor URI', async () => {
      const flagActivity = {
        type: 'Flag',
        id: 'https://example.federation/flags/test-uuid',
        actor: 'https://example.federation/calendars/reporter',
        object: `https://local.instance/events/${testEvent.id}`,
        content: 'Report content',
        tag: [{ type: 'Hashtag', name: '#spam' }],
        published: '2026-02-07T12:00:00Z',
      };

      await inboxService.processFlagActivity(testCalendar, flagActivity);

      expect(moderationInterface.receiveRemoteReport).toHaveBeenCalledWith(
        expect.objectContaining({
          forwardedFromInstance: 'example.federation',
        }),
      );
    });

    it('should handle missing event gracefully', async () => {
      // Mock event not found
      (calendarInterface.getEventById as any).mockResolvedValue(null);

      const flagActivity = {
        type: 'Flag',
        id: 'https://remote.instance/flags/test-uuid',
        actor: 'https://remote.instance/calendars/reporter',
        object: 'https://local.instance/events/nonexistent-event',
        content: 'Report content',
        tag: [{ type: 'Hashtag', name: '#spam' }],
        published: '2026-02-07T12:00:00Z',
      };

      await inboxService.processFlagActivity(testCalendar, flagActivity);

      // Should not create report if event not found
      expect(moderationInterface.receiveRemoteReport).not.toHaveBeenCalled();
    });

    it('should emit reportReceived event', async () => {
      const reportReceivedSpy = vi.fn();
      eventBus.on('reportReceived', reportReceivedSpy);

      const flagActivity = {
        type: 'Flag',
        id: 'https://remote.instance/flags/test-uuid',
        actor: 'https://remote.instance/calendars/reporter',
        object: `https://local.instance/events/${testEvent.id}`,
        content: 'Report content',
        tag: [{ type: 'Hashtag', name: '#spam' }],
        published: '2026-02-07T12:00:00Z',
      };

      await inboxService.processFlagActivity(testCalendar, flagActivity);

      expect(reportReceivedSpy).toHaveBeenCalled();
    });

    it('should handle admin Flag activities with priority', async () => {
      const flagActivity = {
        type: 'Flag',
        id: 'https://remote.instance/flags/admin-flag-uuid',
        actor: 'https://remote.instance/admin',
        attributedTo: 'https://remote.instance/admin',
        object: `https://local.instance/events/${testEvent.id}`,
        content: 'Admin concern',
        tag: [
          { type: 'Hashtag', name: '#admin-flag' },
          { type: 'Hashtag', name: '#priority-high' },
        ],
        published: '2026-02-07T12:00:00Z',
      };

      await inboxService.processFlagActivity(testCalendar, flagActivity);

      // For now, just verify it processes - admin flag handling can be enhanced later
      expect(moderationInterface.receiveRemoteReport).toHaveBeenCalled();
    });

    it('should handle missing moderationInterface gracefully', async () => {
      const inboxServiceWithoutMod = new ProcessInboxService(eventBus, calendarInterface);

      const flagActivity = {
        type: 'Flag',
        id: 'https://remote.instance/flags/test-uuid',
        actor: 'https://remote.instance/calendars/reporter',
        object: `https://local.instance/events/${testEvent.id}`,
        content: 'Report content',
        tag: [{ type: 'Hashtag', name: '#spam' }],
        published: '2026-02-07T12:00:00Z',
      };

      // Should not throw
      await expect(inboxServiceWithoutMod.processFlagActivity(testCalendar, flagActivity)).resolves.not.toThrow();
    });
  });
});
