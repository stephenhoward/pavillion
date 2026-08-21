/**
 * Unit tests for the ActivityPub domain's Flag builder.
 *
 * The builder is the only place a Pavillion `Report` becomes ActivityPub. Its
 * inputs are domain models the moderation side already holds; everything it
 * decides — the minted Flag IRI, the `@context`, the category hashtag, which
 * IRI names the reported event, which actor the Flag is attributed to — is a
 * protocol choice this domain owns alone.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import FlagActivityBuilder from '@/server/activitypub/service/flag-activity-builder';
import FlagActivity from '@/server/activitypub/model/action/flag';
import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';

const DOMAIN = 'local.instance.example';
const SENDER_ACTOR_URI = 'https://local.instance.example/calendars/reporter-calendar';
const RECIPIENT_ACTOR_URI = 'https://remote.instance.example/calendars/origin-calendar';

describe('FlagActivityBuilder', () => {
  let builder: FlagActivityBuilder;
  let ownerReport: Report;
  let adminReport: Report;
  let event: CalendarEvent;

  beforeEach(() => {
    builder = new FlagActivityBuilder(DOMAIN);

    // A standard owner-level report about a locally hosted event.
    ownerReport = new Report('report-uuid-123');
    ownerReport.eventId = 'event-uuid-456';
    ownerReport.calendarId = 'calendar-uuid-789';
    ownerReport.category = ReportCategory.INAPPROPRIATE;
    ownerReport.description = 'This event contains inappropriate content.';
    ownerReport.reporterType = 'authenticated';
    ownerReport.status = ReportStatus.SUBMITTED;
    ownerReport.createdAt = new Date('2026-02-07T12:00:00Z');

    // An admin-initiated report about a locally hosted event: the legacy
    // admin-flag shape.
    adminReport = new Report('admin-report-uuid-999');
    adminReport.eventId = 'event-uuid-456';
    adminReport.calendarId = 'calendar-uuid-789';
    adminReport.category = ReportCategory.HARASSMENT;
    adminReport.description = 'Admin escalation: serious policy violation.';
    adminReport.reporterType = 'administrator';
    adminReport.adminId = 'admin-uuid-111';
    adminReport.adminPriority = 'high';
    adminReport.status = ReportStatus.ESCALATED;
    adminReport.createdAt = new Date('2026-02-07T14:00:00Z');

    event = new CalendarEvent('event-uuid-456');
    event.calendarId = 'calendar-uuid-789';
    event.date = '2026-03-01';
    const content = new CalendarEventContent('en');
    content.title = 'Test Event';
    content.description = 'Event description';
    event.addContent(content);
  });

  describe('owner-level reports', () => {
    it('builds a FlagActivity the outbox can serialize', () => {
      const activity = builder.build(ownerReport, event, SENDER_ACTOR_URI, RECIPIENT_ACTOR_URI);

      // A model instance, not a literal: the outbox persists `toObject()`,
      // which a plain object does not provide.
      expect(activity).toBeInstanceOf(FlagActivity);

      const persisted = activity.toObject();
      expect(persisted).toMatchObject({
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Flag',
        actor: SENDER_ACTOR_URI,
        to: [RECIPIENT_ACTOR_URI],
        object: 'https://local.instance.example/events/event-uuid-456',
        content: 'This event contains inappropriate content.',
        summary: 'Event report: inappropriate',
        published: '2026-02-07T12:00:00.000Z',
      });
      expect(persisted.id).toMatch(/^https:\/\/local\.instance\.example\/flags\//);
      expect(persisted.tag).toEqual([{ type: 'Hashtag', name: '#inappropriate' }]);
    });

    it('renders the report category as the sole hashtag', () => {
      const categories = [
        ReportCategory.SPAM,
        ReportCategory.MISLEADING,
        ReportCategory.HARASSMENT,
        ReportCategory.OTHER,
      ];

      categories.forEach((category) => {
        ownerReport.category = category;
        const activity = builder.build(ownerReport, event, SENDER_ACTOR_URI, RECIPIENT_ACTOR_URI);

        expect(activity.tag).toEqual([{ type: 'Hashtag', name: `#${category}` }]);
        expect(activity.summary).toBe(`Event report: ${category}`);
      });
    });

    it('mints a distinct IRI for each Flag', () => {
      const first = builder.build(ownerReport, event, SENDER_ACTOR_URI, RECIPIENT_ACTOR_URI);
      const second = builder.build(ownerReport, event, SENDER_ACTOR_URI, RECIPIENT_ACTOR_URI);

      expect(first.id).not.toBe(second.id);
    });

    it('publishes the report timestamp, not the send time', () => {
      ownerReport.createdAt = new Date('2026-01-15T08:30:45Z');

      const activity = builder.build(ownerReport, event, SENDER_ACTOR_URI, RECIPIENT_ACTOR_URI);

      expect(activity.toObject().published).toBe('2026-01-15T08:30:45.000Z');
    });
  });

  describe('the reported event IRI', () => {
    it('names a remote event at the IRI its own host serves', () => {
      // The local form would name the id this instance minted for its copy of
      // the federated event. The recipient cannot resolve that and drops the
      // report as referencing an unknown event.
      const remoteEvent = CalendarEvent.fromObject({
        id: 'local-copy-uuid',
        calendarId: null,
        eventSourceUrl: 'https://remote.instance.example/calendars/origin-calendar/events/origin-id',
      });

      const activity = builder.build(ownerReport, remoteEvent, SENDER_ACTOR_URI, RECIPIENT_ACTOR_URI);

      expect(activity.object).toBe(
        'https://remote.instance.example/calendars/origin-calendar/events/origin-id',
      );
    });

    it('names a local event on this instance', () => {
      const activity = builder.build(ownerReport, event, SENDER_ACTOR_URI, RECIPIENT_ACTOR_URI);

      expect(activity.object).toBe('https://local.instance.example/events/event-uuid-456');
    });
  });

  describe('admin-initiated reports about local events', () => {
    it('attributes the Flag to the instance admin URI and tags its priority', () => {
      const activity = builder.build(adminReport, event, SENDER_ACTOR_URI, RECIPIENT_ACTOR_URI);
      const persisted = activity.toObject();

      expect(persisted.actor).toBe('https://local.instance.example/admin');
      expect(persisted.attributedTo).toBe('https://local.instance.example/admin');
      expect(persisted.content).toBe('Admin escalation: serious policy violation.');
      expect(persisted.summary).toBe('Admin report: harassment');
      expect(persisted.tag).toEqual([
        { type: 'Hashtag', name: '#admin-flag' },
        { type: 'Hashtag', name: '#priority-high' },
      ]);
      // The legacy admin shape carries no @context.
      expect(persisted['@context']).toBeUndefined();
    });

    it('defaults an unprioritized admin report to low', () => {
      adminReport.adminPriority = null;

      const activity = builder.build(adminReport, event, SENDER_ACTOR_URI, RECIPIENT_ACTOR_URI);

      expect(activity.tag).toContainEqual({ type: 'Hashtag', name: '#priority-low' });
    });

    it('sends an admin report about a REMOTE event as an ordinary calendar Flag', () => {
      // No owning local calendar exists (calendarId is null), so the admin's
      // primary calendar carries the report as courier. Its actor URI must
      // reach the wire, because the HTTP-Signature keyId resolves to that
      // calendar's key and a mismatch is refused at the far end.
      adminReport.calendarId = null;
      const remoteEvent = CalendarEvent.fromObject({
        id: 'local-copy-uuid',
        calendarId: null,
        eventSourceUrl: 'https://remote.instance.example/calendars/origin-calendar/events/origin-id',
      });

      const activity = builder.build(adminReport, remoteEvent, SENDER_ACTOR_URI, RECIPIENT_ACTOR_URI);

      expect(activity.actor).toBe(SENDER_ACTOR_URI);
      expect(activity.attributedTo).toBeUndefined();
      expect(activity.tag).toEqual([{ type: 'Hashtag', name: '#harassment' }]);
    });

    it('sends an administrator report with no adminId as an ordinary calendar Flag', () => {
      adminReport.adminId = null;

      const activity = builder.build(adminReport, event, SENDER_ACTOR_URI, RECIPIENT_ACTOR_URI);

      expect(activity.actor).toBe(SENDER_ACTOR_URI);
      expect(activity.tag).toEqual([{ type: 'Hashtag', name: '#harassment' }]);
    });
  });
});
