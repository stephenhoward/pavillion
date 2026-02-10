import { describe, it, expect, beforeEach } from 'vitest';

import FlagActivityBuilder from '@/server/moderation/service/flag-activity-builder';
import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';

describe('FlagActivityBuilder', () => {
  let builder: FlagActivityBuilder;
  let ownerReport: Report;
  let adminReport: Report;
  let event: CalendarEvent;

  beforeEach(() => {
    builder = new FlagActivityBuilder('local.instance.example');

    // Create a standard owner report
    ownerReport = new Report('report-uuid-123');
    ownerReport.eventId = 'event-uuid-456';
    ownerReport.calendarId = 'calendar-uuid-789';
    ownerReport.category = ReportCategory.INAPPROPRIATE;
    ownerReport.description = 'This event contains inappropriate content.';
    ownerReport.reporterType = 'authenticated';
    ownerReport.status = ReportStatus.SUBMITTED;
    ownerReport.createdAt = new Date('2026-02-07T12:00:00Z');

    // Create an admin report with priority
    adminReport = new Report('admin-report-uuid-999');
    adminReport.eventId = 'event-uuid-456';
    adminReport.calendarId = 'calendar-uuid-789';
    adminReport.category = ReportCategory.HARASSMENT;
    adminReport.description = 'Admin escalation: serious policy violation.';
    adminReport.reporterType = 'administrator';
    adminReport.adminPriority = 'high';
    adminReport.status = ReportStatus.ESCALATED;
    adminReport.createdAt = new Date('2026-02-07T14:00:00Z');

    // Create a test event
    event = new CalendarEvent('event-uuid-456');
    event.calendarId = 'calendar-uuid-789';
    event.date = '2026-03-01';
    const content = new CalendarEventContent('en');
    content.title = 'Test Event';
    content.description = 'Event description';
    event.addContent(content);
  });

  describe('buildFlagActivity', () => {
    it('should create a valid Flag activity with all required fields', () => {
      const activity = builder.buildFlagActivity(
        ownerReport,
        event,
        'https://local.instance.example/calendars/reporter-calendar',
      );

      expect(activity['@context']).toBe('https://www.w3.org/ns/activitystreams');
      expect(activity.type).toBe('Flag');
      expect(activity.id).toMatch(/^https:\/\/local\.instance\.example\/flags\//);
      expect(activity.actor).toBe('https://local.instance.example/calendars/reporter-calendar');
      expect(activity.object).toBe('https://local.instance.example/events/event-uuid-456');
      expect(activity.content).toBe('This event contains inappropriate content.');
      expect(activity.summary).toBe('Event report: inappropriate');
      expect(activity.published).toBe('2026-02-07T12:00:00.000Z');
    });

    it('should include category hashtag in tag array for owner reports', () => {
      const activity = builder.buildFlagActivity(
        ownerReport,
        event,
        'https://local.instance.example/calendars/reporter-calendar',
      );

      expect(activity.tag).toBeDefined();
      expect(Array.isArray(activity.tag)).toBe(true);
      expect(activity.tag).toHaveLength(1);
      expect(activity.tag[0]).toEqual({
        type: 'Hashtag',
        name: '#inappropriate',
      });
    });

    it('should use event origin for object URI if event is remote', () => {
      // Simulate a remote event by setting calendarId to null
      event.calendarId = null;

      const activity = builder.buildFlagActivity(
        ownerReport,
        event,
        'https://local.instance.example/calendars/reporter-calendar',
        'https://remote.instance.example/events/event-uuid-456',
      );

      expect(activity.object).toBe('https://remote.instance.example/events/event-uuid-456');
    });

    it('should generate unique IDs for each Flag activity', () => {
      const activity1 = builder.buildFlagActivity(
        ownerReport,
        event,
        'https://local.instance.example/calendars/reporter-calendar',
      );

      const activity2 = builder.buildFlagActivity(
        ownerReport,
        event,
        'https://local.instance.example/calendars/reporter-calendar',
      );

      expect(activity1.id).not.toBe(activity2.id);
    });
  });

  describe('buildAdminFlagActivity', () => {
    it('should create admin Flag activity with admin-flag hashtag', () => {
      const activity = builder.buildAdminFlagActivity(
        adminReport,
        event,
        'https://local.instance.example/admin',
      );

      expect(activity.type).toBe('Flag');
      expect(activity.actor).toBe('https://local.instance.example/admin');
      expect(activity.attributedTo).toBe('https://local.instance.example/admin');
      expect(activity.content).toBe('Admin escalation: serious policy violation.');
    });

    it('should include admin-flag and priority tags', () => {
      const activity = builder.buildAdminFlagActivity(
        adminReport,
        event,
        'https://local.instance.example/admin',
      );

      expect(activity.tag).toBeDefined();
      expect(Array.isArray(activity.tag)).toBe(true);
      expect(activity.tag).toHaveLength(2);

      expect(activity.tag).toContainEqual({
        type: 'Hashtag',
        name: '#admin-flag',
      });

      expect(activity.tag).toContainEqual({
        type: 'Hashtag',
        name: '#priority-high',
      });
    });

    it('should handle different priority levels correctly', () => {
      adminReport.adminPriority = 'medium';

      const activity = builder.buildAdminFlagActivity(
        adminReport,
        event,
        'https://local.instance.example/admin',
      );

      expect(activity.tag).toContainEqual({
        type: 'Hashtag',
        name: '#priority-medium',
      });
    });

    it('should default to low priority if none specified', () => {
      adminReport.adminPriority = null;

      const activity = builder.buildAdminFlagActivity(
        adminReport,
        event,
        'https://local.instance.example/admin',
      );

      expect(activity.tag).toContainEqual({
        type: 'Hashtag',
        name: '#priority-low',
      });
    });
  });

  describe('category to hashtag conversion', () => {
    it('should convert spam category to hashtag', () => {
      ownerReport.category = ReportCategory.SPAM;

      const activity = builder.buildFlagActivity(
        ownerReport,
        event,
        'https://local.instance.example/calendars/reporter-calendar',
      );

      expect(activity.tag[0].name).toBe('#spam');
    });

    it('should convert misleading category to hashtag', () => {
      ownerReport.category = ReportCategory.MISLEADING;

      const activity = builder.buildFlagActivity(
        ownerReport,
        event,
        'https://local.instance.example/calendars/reporter-calendar',
      );

      expect(activity.tag[0].name).toBe('#misleading');
    });

    it('should convert harassment category to hashtag', () => {
      ownerReport.category = ReportCategory.HARASSMENT;

      const activity = builder.buildFlagActivity(
        ownerReport,
        event,
        'https://local.instance.example/calendars/reporter-calendar',
      );

      expect(activity.tag[0].name).toBe('#harassment');
    });

    it('should convert other category to hashtag', () => {
      ownerReport.category = ReportCategory.OTHER;

      const activity = builder.buildFlagActivity(
        ownerReport,
        event,
        'https://local.instance.example/calendars/reporter-calendar',
      );

      expect(activity.tag[0].name).toBe('#other');
    });
  });

  describe('summary generation', () => {
    it('should generate summary with category name', () => {
      ownerReport.category = ReportCategory.SPAM;

      const activity = builder.buildFlagActivity(
        ownerReport,
        event,
        'https://local.instance.example/calendars/reporter-calendar',
      );

      expect(activity.summary).toBe('Event report: spam');
    });

    it('should handle different categories in summary', () => {
      const categories = [
        { category: ReportCategory.MISLEADING, expected: 'Event report: misleading' },
        { category: ReportCategory.HARASSMENT, expected: 'Event report: harassment' },
        { category: ReportCategory.OTHER, expected: 'Event report: other' },
      ];

      categories.forEach(({ category, expected }) => {
        ownerReport.category = category;
        const activity = builder.buildFlagActivity(
          ownerReport,
          event,
          'https://local.instance.example/calendars/reporter-calendar',
        );
        expect(activity.summary).toBe(expected);
      });
    });
  });

  describe('published timestamp', () => {
    it('should use report createdAt as published timestamp', () => {
      ownerReport.createdAt = new Date('2026-01-15T08:30:45Z');

      const activity = builder.buildFlagActivity(
        ownerReport,
        event,
        'https://local.instance.example/calendars/reporter-calendar',
      );

      expect(activity.published).toBe('2026-01-15T08:30:45.000Z');
    });

    it('should format timestamp as ISO 8601 string', () => {
      const activity = builder.buildFlagActivity(
        ownerReport,
        event,
        'https://local.instance.example/calendars/reporter-calendar',
      );

      // Verify ISO 8601 format
      expect(activity.published).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});
