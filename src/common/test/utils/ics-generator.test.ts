import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';

import { CalendarEvent, CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { EventLocation } from '@/common/model/location';
import { generateInstanceIcs } from '@/common/utils/ics-generator';

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
    describe('site-shaped instance (public events carry no schedules)', () => {
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('produces this exact calendar file', () => {
        const event = makeEvent({ location: makeLocation() });
        const instance = new CalendarEventInstance(
          'inst-1',
          event,
          DateTime.fromISO('2026-11-03T18:15:00Z'),
          DateTime.fromISO('2026-11-03T19:15:00Z'),
        );

        const ics = generateInstanceIcs(
          instance,
          'Riverside Allotments Community Workday, Seed Swap; and Potluck Supper',
          'Bring gloves, tools; and a dish.\nAll welcome',
          'pavillion.example',
        );

        expect(ics).toBe([
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//Pavillion//Events//EN',
          'CALSCALE:GREGORIAN',
          'METHOD:PUBLISH',
          'BEGIN:VEVENT',
          'UID:evt-123-20261103T181500Z@pavillion.example',
          'DTSTAMP:20261030T120000Z',
          'DTSTART:20261103T181500Z',
          'DTEND:20261103T191500Z',
          'SUMMARY:Riverside Allotments Community Workday\\, Seed Swap\\; and Potluck Su',
          ' pper',
          'DESCRIPTION:Bring gloves\\, tools\\; and a dish.\\nAll welcome',
          'LOCATION:City Hall\\, 100 Main St\\, Springfield\\, IL 62701',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n'));
      });

      it('produces valid ICS with no recurrence when the event has no schedules', () => {
        const event = makeEvent();
        const instance = new CalendarEventInstance(
          'inst-1',
          event,
          DateTime.fromISO('2026-11-03T18:15:00Z'),
          null,
        );

        const ics = generateInstanceIcs(instance, 'No Schedule Event', '', 'example.com');

        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).toContain('SUMMARY:No Schedule Event');
        expect(ics).not.toContain('RRULE');
        expect(ics).not.toContain('DTEND');
      });
    });

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

    it('should include UID with hostname', () => {
      const event = makeEvent();
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-01T18:00:00Z'),
        null,
      );

      const ics = generateInstanceIcs(instance, 'Test', '', 'pavillion.example');

      expect(ics).toContain('UID:evt-123-20260401T180000Z@pavillion.example');
    });

    it('gives two occurrences of one event different UIDs', () => {
      const event = makeEvent({ schedules: [makeWeeklySchedule()] });
      const first = new CalendarEventInstance('inst-1', event, DateTime.fromISO('2026-04-01T18:00:00Z'), null);
      const second = new CalendarEventInstance('inst-2', event, DateTime.fromISO('2026-04-08T18:00:00Z'), null);

      const uidOf = (instance: CalendarEventInstance) =>
        generateInstanceIcs(instance, 'Test', '', 'pavillion.example')
          .split('\r\n').find(l => l.startsWith('UID:'));

      expect(uidOf(first)).toBe('UID:evt-123-20260401T180000Z@pavillion.example');
      expect(uidOf(second)).toBe('UID:evt-123-20260408T180000Z@pavillion.example');
    });

    it('gives the same occurrence the same UID when exported twice', () => {
      const event = makeEvent();
      const uidOf = () => generateInstanceIcs(
        new CalendarEventInstance('inst-1', event, DateTime.fromISO('2026-04-01T13:00:00-05:00'), null),
        'Test', '', 'pavillion.example',
      ).split('\r\n').find(l => l.startsWith('UID:'));

      expect(uidOf()).toBe('UID:evt-123-20260401T180000Z@pavillion.example');
      expect(uidOf()).toBe(uidOf());
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

    it('exports only the instance, with no recurrence, even when the event carries schedules', () => {
      const schedule = makeWeeklySchedule();
      const cancellation = new CalendarEventSchedule(
        'sched-2',
        DateTime.fromISO('2026-04-15T18:00:00', { zone: 'utc' }),
      );
      cancellation.isExclusion = true;

      const event = makeEvent({ schedules: [schedule, cancellation] });
      const instance = new CalendarEventInstance(
        'inst-1',
        event,
        DateTime.fromISO('2026-04-08T18:00:00Z'),
        DateTime.fromISO('2026-04-08T20:00:00Z'),
      );

      const ics = generateInstanceIcs(instance, 'Test', '', 'example.com');

      expect(ics).toContain('DTSTART:20260408T180000Z');
      expect(ics).toContain('DTEND:20260408T200000Z');
      expect(ics).not.toContain('RRULE');
      expect(ics).not.toContain('EXDATE');
      expect(ics).not.toContain('RECURRENCE-ID');
      expect(ics.split('BEGIN:VEVENT').length).toBe(2);
    });
  });
});
