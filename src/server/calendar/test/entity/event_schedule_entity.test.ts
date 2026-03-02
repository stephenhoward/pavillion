import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';

import { EventScheduleEntity } from '@/server/calendar/entity/event';
import { CalendarEventSchedule } from '@/common/model/events';

// Import event.ts triggers entity registration and association setup.
import '@/server/calendar/entity/event';

describe('EventScheduleEntity', () => {
  describe('fromModel', () => {
    it('stores the timezone from the schedule model', () => {
      const startDate = DateTime.fromISO('2025-05-24T08:00:00.000', { zone: 'America/Los_Angeles' });
      const endDate = DateTime.fromISO('2025-05-24T10:00:00.000', { zone: 'America/Los_Angeles' });
      const schedule = new CalendarEventSchedule('sched-1', startDate, endDate);

      const entity = EventScheduleEntity.fromModel(schedule);

      expect(entity.timezone).toBe('America/Los_Angeles');
    });

    it('stores local time digits as UTC in start_date and end_date', () => {
      // A schedule at 08:00 America/Los_Angeles
      const startDate = DateTime.fromISO('2025-05-24T08:00:00.000', { zone: 'America/Los_Angeles' });
      const endDate = DateTime.fromISO('2025-05-24T10:00:00.000', { zone: 'America/Los_Angeles' });
      const schedule = new CalendarEventSchedule('sched-1', startDate, endDate);

      const entity = EventScheduleEntity.fromModel(schedule);

      // The stored Date's UTC hour must equal the local-time hour (08), not the UTC equivalent
      expect(entity.start_date.getUTCHours()).toBe(8);
      expect(entity.end_date.getUTCHours()).toBe(10);
    });

    it('falls back to UTC timezone when startDate is null', () => {
      const schedule = new CalendarEventSchedule('sched-1');

      const entity = EventScheduleEntity.fromModel(schedule);

      expect(entity.timezone).toBe('UTC');
    });

    it('stores other schedule fields correctly', () => {
      const startDate = DateTime.fromISO('2025-05-24T08:00:00.000', { zone: 'America/New_York' });
      const schedule = new CalendarEventSchedule('sched-2', startDate);
      schedule.frequency = null;
      schedule.interval = 1;
      schedule.count = 5;
      schedule.byDay = ['MO', 'WE', 'FR'];
      schedule.isExclusion = false;

      const entity = EventScheduleEntity.fromModel(schedule);

      expect(entity.id).toBe('sched-2');
      expect(entity.interval).toBe(1);
      expect(entity.count).toBe(5);
      expect(entity.by_day).toBe('MO,WE,FR');
      expect(entity.is_exclusion).toBe(false);
    });
  });

  describe('toModel', () => {
    it('reinterprets UTC-stored date digits as the event timezone', () => {
      // Simulate what Sequelize reads back from SQLite: UTC Date where UTC digits
      // represent the original local time (08:00 America/Los_Angeles)
      const storedDate = new Date('2025-05-24T08:00:00.000Z'); // UTC 08:00 = local 08:00 LA

      const entity = EventScheduleEntity.build({
        id: 'sched-1',
        timezone: 'America/Los_Angeles',
        start_date: storedDate,
        end_date: new Date('2025-05-24T10:00:00.000Z'),
        frequency: null,
        interval: 0,
        count: 0,
        by_day: '',
        is_exclusion: false,
      });

      const model = entity.toModel();

      // The resulting DateTime must be in America/Los_Angeles zone
      expect(model.startDate?.zoneName).toBe('America/Los_Angeles');
      // And the local hour must be 8 (not converted back to UTC equivalent)
      expect(model.startDate?.hour).toBe(8);
      expect(model.endDate?.hour).toBe(10);
    });

    it('falls back to UTC zone when timezone field is empty', () => {
      const storedDate = new Date('2025-05-24T14:00:00.000Z');

      const entity = EventScheduleEntity.build({
        id: 'sched-2',
        timezone: '',
        start_date: storedDate,
        end_date: null,
        frequency: null,
        interval: 0,
        count: 0,
        by_day: '',
        is_exclusion: false,
      });

      const model = entity.toModel();

      expect(model.startDate?.zoneName).toBe('UTC');
      expect(model.startDate?.hour).toBe(14);
    });

    it('handles null start_date and end_date gracefully', () => {
      const entity = EventScheduleEntity.build({
        id: 'sched-3',
        timezone: 'America/Chicago',
        start_date: null,
        end_date: null,
        frequency: null,
        interval: 0,
        count: 0,
        by_day: '',
        is_exclusion: false,
      });

      const model = entity.toModel();

      expect(model.startDate).toBeNull();
      expect(model.endDate).toBeNull();
    });
  });

  describe('round-trip conversion', () => {
    it('preserves local time digits through fromModel -> toModel', () => {
      // Start with a schedule at 08:00 in America/Los_Angeles
      const localStart = DateTime.fromISO('2025-05-24T08:00:00.000', { zone: 'America/Los_Angeles' });
      const localEnd = DateTime.fromISO('2025-05-24T10:30:00.000', { zone: 'America/Los_Angeles' });
      const schedule = new CalendarEventSchedule('sched-rt', localStart, localEnd);

      const entity = EventScheduleEntity.fromModel(schedule);
      const recovered = entity.toModel();

      // The recovered DateTime must be in the same zone
      expect(recovered.startDate?.zoneName).toBe('America/Los_Angeles');
      // And the local hour/minute must be preserved
      expect(recovered.startDate?.hour).toBe(8);
      expect(recovered.startDate?.minute).toBe(0);
      expect(recovered.endDate?.hour).toBe(10);
      expect(recovered.endDate?.minute).toBe(30);
    });

    it('preserves timezone info through fromModel -> toModel', () => {
      const localStart = DateTime.fromISO('2025-07-04T09:00:00.000', { zone: 'Europe/London' });
      const schedule = new CalendarEventSchedule('sched-tz', localStart);

      const entity = EventScheduleEntity.fromModel(schedule);
      const recovered = entity.toModel();

      expect(recovered.startDate?.zoneName).toBe('Europe/London');
      expect(recovered.startDate?.hour).toBe(9);
    });
  });
});
