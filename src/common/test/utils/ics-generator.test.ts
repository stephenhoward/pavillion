import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';

import { CalendarEvent, CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { EventLocation } from '@/common/model/location';
import { generateInstanceIcs, generateEventIcs } from '@/common/utils/ics-generator';

function makeEvent(overrides?: Partial<{ location: EventLocation; schedules: CalendarEventSchedule[] }>): CalendarEvent {
  const event = new CalendarEvent('evt-123', 'cal-456');
  event.addContent({ language: 'en', name: 'Community Meetup', description: 'A fun gathering', isEmpty: () => false, toObject: () => ({ language: 'en', name: 'Community Meetup', title: 'Community Meetup', description: 'A fun gathering' }) } as any);

  if (overrides?.location) {
    event.location = overrides.location;
  }
  if (overrides?.schedules) {
    event.schedules = overrides.schedules;
  }
  return event;
}

function makeLocation(): EventLocation {
  const loc = new EventLocation('loc-1');
  loc.name = 'City Hall';
  loc.address = '100 Main St';
  loc.city = 'Springfield';
  loc.state = 'IL';
  loc.postalCode = '62701';
  return loc;
}

function makeWeeklySchedule(): CalendarEventSchedule {
  const schedule = new CalendarEventSchedule(
    'sched-1',
    DateTime.fromISO('2026-04-01T18:00:00', { zone: 'utc' }),
    DateTime.fromISO('2026-06-30T18:00:00', { zone: 'utc' }),
  );
  schedule.frequency = EventFrequency.WEEKLY;
  schedule.interval = 1;
  schedule.byDay = ['0', '2']; // Monday, Wednesday
  return schedule;
}

describe('ICS Generator', () => {
  describe('generateInstanceIcs', () => {
    it('should produce valid VCALENDAR structure', () => {
      const event = makeEvent();
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-01T18:00:00Z'),
        DateTime.fromISO('2026-04-01T20:00:00Z'),
      );

      const ics = generateInstanceIcs(instance, 'Community Meetup', 'A fun gathering', 'example.com');

      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('END:VCALENDAR');
      expect(ics).toContain('BEGIN:VEVENT');
      expect(ics).toContain('END:VEVENT');
      expect(ics).toContain('VERSION:2.0');
      expect(ics).toContain('PRODID:-//Pavillion//Events//EN');
    });

    it('should include DTSTART and DTEND from instance', () => {
      const event = makeEvent();
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-01T18:00:00Z'),
        DateTime.fromISO('2026-04-01T20:00:00Z'),
      );

      const ics = generateInstanceIcs(instance, 'Community Meetup', '', 'example.com');

      expect(ics).toContain('DTSTART:20260401T180000Z');
      expect(ics).toContain('DTEND:20260401T200000Z');
    });

    it('should include event name and description', () => {
      const event = makeEvent();
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-01T18:00:00Z'),
        null,
      );

      const ics = generateInstanceIcs(instance, 'Community Meetup', 'A fun gathering', 'example.com');

      expect(ics).toContain('SUMMARY:Community Meetup');
      expect(ics).toContain('DESCRIPTION:A fun gathering');
    });

    it('should include location when present', () => {
      const event = makeEvent({ location: makeLocation() });
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-01T18:00:00Z'),
        null,
      );

      const ics = generateInstanceIcs(instance, 'Test', '', 'example.com');

      expect(ics).toContain('LOCATION:City Hall');
      expect(ics).toContain('100 Main St');
      expect(ics).toContain('Springfield');
    });

    it('should include RRULE from event schedules', () => {
      const schedule = makeWeeklySchedule();
      const event = makeEvent({ schedules: [schedule] });
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-01T18:00:00Z'),
        DateTime.fromISO('2026-04-01T20:00:00Z'),
      );

      const ics = generateInstanceIcs(instance, 'Test', '', 'example.com');

      expect(ics).toContain('RRULE:FREQ=WEEKLY');
      expect(ics).toContain('BYDAY=MO,WE');
    });

    it('should include UID with hostname', () => {
      const event = makeEvent();
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-01T18:00:00Z'),
        null,
      );

      const ics = generateInstanceIcs(instance, 'Test', '', 'pavillion.example');

      expect(ics).toContain('UID:evt-123@pavillion.example');
    });

    it('should escape special characters in text fields', () => {
      const event = makeEvent();
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-01T18:00:00Z'),
        null,
      );

      const ics = generateInstanceIcs(instance, 'Event; with, special chars', 'Line 1\nLine 2', 'example.com');

      expect(ics).toContain('SUMMARY:Event\\; with\\, special chars');
      expect(ics).toContain('DESCRIPTION:Line 1\\nLine 2');
    });

    it('should escape CRLF sequences to prevent ICS injection', () => {
      const event = makeEvent();
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-01T18:00:00Z'),
        null,
      );

      const maliciousName = 'Real Event\r\nBEGIN:VEVENT\r\nSUMMARY:Injected';
      const ics = generateInstanceIcs(instance, maliciousName, 'desc\rwith\r\ncrlf', 'example.com');

      // CRLF should be escaped — no raw \r\nBEGIN or \r\nSUMMARY injecting new ICS properties
      // (folded continuation lines start with a space, so they're safe)
      expect(ics).not.toContain('\r\nBEGIN:VEVENT\r\nSUMMARY:Injected');
      // The escaped content should contain \n literals, not raw line breaks
      const summaryLine = ics.split('\r\n').find(l => l.startsWith('SUMMARY:') || l.match(/^ .*SUMMARY/));
      expect(summaryLine).toContain('Real Event\\n');
    });

    it('should omit frequency-based exclusions (EXRULE is deprecated in RFC 5545)', () => {
      const inclusion = makeWeeklySchedule();
      const exclusion = new CalendarEventSchedule(
        'sched-2',
        DateTime.fromISO('2026-04-15T18:00:00', { zone: 'utc' }),
      );
      exclusion.frequency = EventFrequency.WEEKLY;
      exclusion.interval = 4;
      exclusion.isExclusion = true;

      const event = makeEvent({ schedules: [inclusion, exclusion] });
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-01T18:00:00Z'),
        null,
      );

      const ics = generateInstanceIcs(instance, 'Test', '', 'example.com');

      expect(ics).toContain('RRULE:FREQ=WEEKLY');
      expect(ics).not.toContain('EXRULE');
    });

    it('should emit EXDATE for hidden cancellations (hideFromPublic=true)', () => {
      const inclusion = makeWeeklySchedule();
      const exclusion = new CalendarEventSchedule(
        'sched-2',
        DateTime.fromISO('2026-04-15T18:00:00', { zone: 'utc' }),
      );
      exclusion.isExclusion = true;
      exclusion.hideFromPublic = true;

      const event = makeEvent({ schedules: [inclusion, exclusion] });
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-01T18:00:00Z'),
        null,
      );

      const ics = generateInstanceIcs(instance, 'Test', '', 'example.com');

      expect(ics).toContain('EXDATE:20260415T180000Z');
      // No sibling VEVENT for hidden cancellations.
      expect(ics).not.toContain('STATUS:CANCELLED');
      expect(ics).not.toContain('RECURRENCE-ID');
    });

    it('should emit a sibling VEVENT with RECURRENCE-ID + STATUS:CANCELLED for shown cancellations', () => {
      const inclusion = makeWeeklySchedule();
      inclusion.eventEndTime = DateTime.fromISO('2026-04-01T20:00:00', { zone: 'utc' });
      const exclusion = new CalendarEventSchedule(
        'sched-2',
        DateTime.fromISO('2026-04-15T18:00:00', { zone: 'utc' }),
      );
      exclusion.isExclusion = true;
      exclusion.hideFromPublic = false;

      const event = makeEvent({ schedules: [inclusion, exclusion] });
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-01T18:00:00Z'),
        DateTime.fromISO('2026-04-01T20:00:00Z'),
      );

      const ics = generateInstanceIcs(instance, 'Community Meetup', '', 'pavillion.example');

      // No EXDATE for shown cancellations.
      expect(ics).not.toContain('EXDATE');

      // Parent VEVENT and a sibling VEVENT both present.
      const blocks = ics.split('BEGIN:VEVENT');
      expect(blocks.length).toBe(3); // preamble + parent + sibling

      const sibling = 'BEGIN:VEVENT' + blocks[2];
      expect(sibling).toContain('UID:evt-123@pavillion.example');
      expect(sibling).toContain('RECURRENCE-ID:20260415T180000Z');
      expect(sibling).toContain('DTSTART:20260415T180000Z');
      expect(sibling).toContain('DTEND:20260415T200000Z'); // +2h duration from inclusion
      expect(sibling).toContain('SUMMARY:Community Meetup');
      expect(sibling).toContain('STATUS:CANCELLED');
      expect(sibling).toContain('END:VEVENT');
    });

    it('should omit DTEND on sibling when event has no derivable duration', () => {
      const inclusion = new CalendarEventSchedule(
        'sched-1',
        DateTime.fromISO('2026-04-01T18:00:00', { zone: 'utc' }),
      );
      inclusion.frequency = EventFrequency.WEEKLY;
      inclusion.interval = 1;
      // No eventEndTime → no duration derivable.

      const exclusion = new CalendarEventSchedule(
        'sched-2',
        DateTime.fromISO('2026-04-15T18:00:00', { zone: 'utc' }),
      );
      exclusion.isExclusion = true;
      exclusion.hideFromPublic = false;

      const event = makeEvent({ schedules: [inclusion, exclusion] });
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-01T18:00:00Z'),
        null,
      );

      const ics = generateInstanceIcs(instance, 'Test', '', 'example.com');

      const blocks = ics.split('BEGIN:VEVENT');
      const sibling = 'BEGIN:VEVENT' + blocks[2];
      expect(sibling).toContain('STATUS:CANCELLED');
      expect(sibling).not.toContain('DTEND:');
    });

    it('should emit mixed EXDATE + sibling VEVENT when both hidden and shown cancellations exist', () => {
      const inclusion = makeWeeklySchedule();
      inclusion.eventEndTime = DateTime.fromISO('2026-04-01T20:00:00', { zone: 'utc' });

      const hidden = new CalendarEventSchedule(
        'sched-2',
        DateTime.fromISO('2026-04-08T18:00:00', { zone: 'utc' }),
      );
      hidden.isExclusion = true;
      hidden.hideFromPublic = true;

      const shown = new CalendarEventSchedule(
        'sched-3',
        DateTime.fromISO('2026-04-15T18:00:00', { zone: 'utc' }),
      );
      shown.isExclusion = true;
      shown.hideFromPublic = false;

      const event = makeEvent({ schedules: [inclusion, hidden, shown] });
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-01T18:00:00Z'),
        DateTime.fromISO('2026-04-01T20:00:00Z'),
      );

      const ics = generateInstanceIcs(instance, 'Test', '', 'example.com');

      expect(ics).toContain('EXDATE:20260408T180000Z');
      expect(ics).not.toContain('EXDATE:20260415T180000Z');
      expect(ics).toContain('RECURRENCE-ID:20260415T180000Z');
      expect(ics).toContain('STATUS:CANCELLED');
    });
  });

  describe('generateEventIcs', () => {
    it('should use first schedule start date as DTSTART', () => {
      const schedule = makeWeeklySchedule();
      const event = makeEvent({ schedules: [schedule] });

      const ics = generateEventIcs(event, 'Weekly Meetup', '', 'example.com');

      expect(ics).toContain('DTSTART:20260401T180000Z');
      expect(ics).toContain('RRULE:FREQ=WEEKLY');
    });

    it('should include RRULE with COUNT when set', () => {
      const schedule = new CalendarEventSchedule(
        'sched-1',
        DateTime.fromISO('2026-04-01T18:00:00', { zone: 'utc' }),
      );
      schedule.frequency = EventFrequency.DAILY;
      schedule.interval = 1;
      schedule.count = 10;

      const event = makeEvent({ schedules: [schedule] });

      const ics = generateEventIcs(event, 'Daily Standup', '', 'example.com');

      expect(ics).toContain('RRULE:FREQ=DAILY;COUNT=10');
    });

    it('should produce valid ICS without schedules', () => {
      const event = makeEvent();

      const ics = generateEventIcs(event, 'No Schedule Event', '', 'example.com');

      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('SUMMARY:No Schedule Event');
      expect(ics).not.toContain('RRULE');
    });
  });
});
