import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

// Mocked so the misdirected-Flag test can assert the rejection log, which is
// the only durable record that a dropped Flag arrived: no report is filed.
vi.mock('@/server/activitypub/helper/rejection-logger', () => ({
  logActivityRejection: vi.fn(),
}));

import { logActivityRejection } from '@/server/activitypub/helper/rejection-logger';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import CalendarInterface from '@/server/calendar/interface';
import ModerationInterface from '@/server/moderation/interface';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { ReportStatus } from '@/common/model/report';
import type { ReporterType } from '@/common/model/report';
import { FederatedReportRateLimitError, ReportValidationError } from '@/common/exceptions/report';
import { EventNotFoundError } from '@/common/exceptions/calendar';

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

      // Verify report was created. The actorUri MUST be forwarded so
      // moderation can include it on the `moderation:report:flagged`
      // bus payload — this is the link that lets the notifications
      // domain stamp `https://<host>` attribution on federated Flag
      // rows. The notifications
      // domain itself is never called from this code path; the
      // moderation bus event is the sole bridge.
      expect(moderationInterface.receiveRemoteReport).toHaveBeenCalledWith({
        eventId: testEvent.id,
        category: 'spam',
        description: 'This event contains spam',
        forwardedFromInstance: 'remote.instance',
        forwardedReportId: 'https://remote.instance/flags/test-flag-uuid',
        actorUri: 'https://remote.instance/calendars/reporter-calendar',
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

    it('should drop a Flag naming an event that does not exist', async () => {
      // getEventById throws rather than returning null. An unknown event is
      // a policy outcome, not a processing failure: the Flag settles as a
      // quiet rejection, never as an ap_inbox error row, so a remote cannot
      // manufacture error-level noise at rate-limit speed.
      const mockLogRejection = logActivityRejection as ReturnType<typeof vi.fn>;
      mockLogRejection.mockClear();
      (calendarInterface.getEventById as any).mockRejectedValue(new EventNotFoundError());

      const flagActivity = {
        type: 'Flag',
        id: 'https://remote.instance/flags/test-uuid',
        actor: 'https://remote.instance/calendars/reporter',
        object: `https://local.instance/events/${uuidv4()}`,
        content: 'Report content',
        tag: [{ type: 'Hashtag', name: '#spam' }],
        published: '2026-02-07T12:00:00Z',
      };

      await expect(inboxService.processFlagActivity(testCalendar, flagActivity)).resolves.toBeUndefined();

      expect(moderationInterface.receiveRemoteReport).not.toHaveBeenCalled();
      expect(mockLogRejection).toHaveBeenCalledOnce();
      const context = mockLogRejection.mock.calls[0][0];
      expect(context.rejection_type).toBe('invalid_object');
      expect(context.activity_type).toBe('Flag');
      expect(context.actor_uri).toBe('https://remote.instance');
      expect(context.calendar_id).toBe(testCalendar.id);
    });

    it('should drop a Flag whose object id is not a UUID without looking it up', async () => {
      // A hex-and-dash string that is not a UUID would otherwise reach a UUID
      // column and fail with a cast error, again settling the row as an error.
      const mockLogRejection = logActivityRejection as ReturnType<typeof vi.fn>;
      mockLogRejection.mockClear();

      const flagActivity = {
        type: 'Flag',
        id: 'https://remote.instance/flags/test-uuid',
        actor: 'https://remote.instance/calendars/reporter',
        object: 'https://local.instance/events/deadbeef-dead-beef-dead-beef',
        content: 'Report content',
        tag: [{ type: 'Hashtag', name: '#spam' }],
        published: '2026-02-07T12:00:00Z',
      };

      await expect(inboxService.processFlagActivity(testCalendar, flagActivity)).resolves.toBeUndefined();

      expect(calendarInterface.getEventById).not.toHaveBeenCalled();
      expect(moderationInterface.receiveRemoteReport).not.toHaveBeenCalled();
      expect(mockLogRejection).toHaveBeenCalledOnce();
      expect(mockLogRejection.mock.calls[0][0].rejection_type).toBe('invalid_object');
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

    it('should drop a Flag delivered to a calendar that does not own the event', async () => {
      // A Flag belongs in the inbox of the object's host. Filing it anyway
      // would let a sender spread reports about one event across enumerable
      // calendar inboxes, staying under each inbox's rate limiter while
      // multiplying throughput against a single target.
      const otherCalendar = new Calendar(uuidv4(), 'unrelated-calendar');

      const flagActivity = {
        type: 'Flag',
        id: 'https://remote.instance/flags/misdirected-uuid',
        actor: 'https://remote.instance/calendars/reporter',
        object: `https://local.instance/events/${testEvent.id}`,
        content: 'Report content',
        tag: [{ type: 'Hashtag', name: '#spam' }],
        published: '2026-02-07T12:00:00Z',
      };

      await inboxService.processFlagActivity(otherCalendar, flagActivity);

      expect(moderationInterface.receiveRemoteReport).not.toHaveBeenCalled();
    });

    it('should log a misdirected Flag with the actor reduced to its host', async () => {
      // Nothing else records that this Flag arrived and was refused — no
      // report is written — so the rejection log is the whole audit trail.
      // It must still honour the Flag log-redaction posture: the per-actor
      // URI is never written durably, only the sending instance's host.
      const mockLogRejection = logActivityRejection as ReturnType<typeof vi.fn>;
      mockLogRejection.mockClear();

      const otherCalendar = new Calendar(uuidv4(), 'unrelated-calendar');
      const flagActivity = {
        type: 'Flag',
        id: 'https://remote.instance/flags/misdirected-logged',
        actor: 'https://remote.instance/calendars/reporter',
        object: `https://local.instance/events/${testEvent.id}`,
        content: 'Report content',
        tag: [{ type: 'Hashtag', name: '#spam' }],
        published: '2026-02-07T12:00:00Z',
      };

      await inboxService.processFlagActivity(otherCalendar, flagActivity);

      expect(mockLogRejection).toHaveBeenCalledOnce();
      const context = mockLogRejection.mock.calls[0][0];
      expect(context.rejection_type).toBe('misdirected_activity');
      expect(context.activity_type).toBe('Flag');
      expect(context.actor_uri, 'the reporter actor URI must be reduced to its host')
        .toBe('https://remote.instance');
      expect(context.actor_domain).toBe('remote.instance');
      expect(context.calendar_id).toBe(otherCalendar.id);
    });

    it('should not emit reportReceived when the report is suppressed by the per-instance cap', async () => {
      // Suppression is a policy outcome, not a processing failure: the
      // handler must settle cleanly so the ap_inbox row is not marked errored.
      (moderationInterface.receiveRemoteReport as any).mockRejectedValue(new FederatedReportRateLimitError());
      const reportReceivedSpy = vi.fn();
      eventBus.on('reportReceived', reportReceivedSpy);

      const flagActivity = {
        type: 'Flag',
        id: 'https://remote.instance/flags/throttled-uuid',
        actor: 'https://remote.instance/calendars/reporter',
        object: `https://local.instance/events/${testEvent.id}`,
        content: 'Report content',
        tag: [{ type: 'Hashtag', name: '#spam' }],
        published: '2026-02-07T12:00:00Z',
      };

      await expect(inboxService.processFlagActivity(testCalendar, flagActivity)).resolves.not.toThrow();

      expect(reportReceivedSpy).not.toHaveBeenCalled();
    });

    it('should propagate a report validation failure', async () => {
      // Anything the service refuses as malformed is a genuine processing
      // failure and must surface, so the ap_inbox row records it as an error.
      (moderationInterface.receiveRemoteReport as any).mockRejectedValue(
        new ReportValidationError(['Description must be 2000 characters or fewer']),
      );

      const flagActivity = {
        type: 'Flag',
        id: 'https://remote.instance/flags/oversized-uuid',
        actor: 'https://remote.instance/calendars/reporter',
        object: `https://local.instance/events/${testEvent.id}`,
        content: 'x'.repeat(2001),
        tag: [{ type: 'Hashtag', name: '#spam' }],
        published: '2026-02-07T12:00:00Z',
      };

      await expect(inboxService.processFlagActivity(testCalendar, flagActivity))
        .rejects.toBeInstanceOf(ReportValidationError);
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
