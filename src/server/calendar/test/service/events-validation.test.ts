import { describe, it, expect, beforeEach } from 'vitest';
import EventsService, { validateMediaTransform, validateSchedulesByDay, validateSchedulesEndTime } from '@/server/calendar/service/events';
import { ValidationError } from '@/common/exceptions/base';
import { Account } from '@/common/model/account';
import { EventEmitter } from 'events';

describe('EventsService - Validation', () => {
  let service: EventsService;
  let mockAccount: Account;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    service = new EventsService(eventBus);
    mockAccount = new Account('test-account-id');
    mockAccount.email = 'test@example.com';
  });

  describe('getEventById', () => {
    it('should throw ValidationError when eventId is empty', async () => {
      await expect(
        service.getEventById(''),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.getEventById(''),
      ).rejects.toThrow('eventId is required');
    });

    it('should throw ValidationError when eventId is whitespace', async () => {
      await expect(
        service.getEventById('   '),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.getEventById('   '),
      ).rejects.toThrow('eventId is required');
    });
  });

  describe('updateEvent', () => {
    it('should throw ValidationError when eventId is empty', async () => {
      await expect(
        service.updateEvent(mockAccount, '', {}),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.updateEvent(mockAccount, '', {}),
      ).rejects.toThrow('Event ID is required');
    });
  });

  describe('deleteEvent', () => {
    it('should throw ValidationError when eventId is empty', async () => {
      await expect(
        service.deleteEvent(mockAccount, ''),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.deleteEvent(mockAccount, ''),
      ).rejects.toThrow('Event ID is required');
    });
  });

  describe('bulkAssignCategories', () => {
    it('should throw ValidationError when eventIds is not an array', async () => {
      await expect(
        service.bulkAssignCategories(mockAccount, null as any, ['cat-1']),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.bulkAssignCategories(mockAccount, null as any, ['cat-1']),
      ).rejects.toThrow('eventIds must be a non-empty array');
    });

    it('should throw ValidationError when eventIds is empty array', async () => {
      await expect(
        service.bulkAssignCategories(mockAccount, [], ['cat-1']),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.bulkAssignCategories(mockAccount, [], ['cat-1']),
      ).rejects.toThrow('eventIds must be a non-empty array');
    });

    it('should throw ValidationError when categoryIds is not an array', async () => {
      await expect(
        service.bulkAssignCategories(mockAccount, ['event-1'], null as any),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.bulkAssignCategories(mockAccount, ['event-1'], null as any),
      ).rejects.toThrow('categoryIds must be a non-empty array');
    });

    it('should throw ValidationError when categoryIds is empty array', async () => {
      await expect(
        service.bulkAssignCategories(mockAccount, ['event-1'], []),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.bulkAssignCategories(mockAccount, ['event-1'], []),
      ).rejects.toThrow('categoryIds must be a non-empty array');
    });

    it('should throw ValidationError when eventIds contains non-string', async () => {
      await expect(
        service.bulkAssignCategories(mockAccount, [123 as any, 'event-2'], ['cat-1']),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.bulkAssignCategories(mockAccount, [123 as any, 'event-2'], ['cat-1']),
      ).rejects.toThrow('all eventIds must be strings');
    });

    it('should throw ValidationError when categoryIds contains non-string', async () => {
      await expect(
        service.bulkAssignCategories(mockAccount, ['event-1'], [123 as any, 'cat-2']),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.bulkAssignCategories(mockAccount, ['event-1'], [123 as any, 'cat-2']),
      ).rejects.toThrow('all categoryIds must be strings');
    });
  });

  describe('validateMediaTransform', () => {
    it('accepts boundary focal point values 0 and 1 and zoom 1', () => {
      expect(() => validateMediaTransform({ mediaFocalPointX: 0, mediaFocalPointY: 1, mediaZoom: 1 })).not.toThrow();
      expect(() => validateMediaTransform({ mediaFocalPointX: 1, mediaFocalPointY: 0 })).not.toThrow();
      expect(() => validateMediaTransform({ mediaFocalPointX: 0.5, mediaFocalPointY: 0.25, mediaZoom: 2.5 })).not.toThrow();
    });

    it('skips undefined and null values', () => {
      expect(() => validateMediaTransform({})).not.toThrow();
      expect(() => validateMediaTransform({ mediaFocalPointX: undefined, mediaFocalPointY: null, mediaZoom: null })).not.toThrow();
    });

    it('rejects focal point X below 0', () => {
      expect(() => validateMediaTransform({ mediaFocalPointX: -0.1 })).toThrow(ValidationError);
    });

    it('rejects focal point X above 1', () => {
      expect(() => validateMediaTransform({ mediaFocalPointX: 1.1 })).toThrow(ValidationError);
    });

    it('rejects focal point Y out of range', () => {
      expect(() => validateMediaTransform({ mediaFocalPointY: 2 })).toThrow(ValidationError);
      expect(() => validateMediaTransform({ mediaFocalPointY: -1 })).toThrow(ValidationError);
    });

    it('rejects zoom below 1', () => {
      expect(() => validateMediaTransform({ mediaZoom: 0.5 })).toThrow(ValidationError);
    });

    it('rejects non-numeric and non-finite values', () => {
      expect(() => validateMediaTransform({ mediaFocalPointX: 'x' })).toThrow(ValidationError);
      expect(() => validateMediaTransform({ mediaZoom: NaN })).toThrow(ValidationError);
      expect(() => validateMediaTransform({ mediaZoom: Infinity })).toThrow(ValidationError);
    });
  });

  describe('createEvent media transform validation', () => {
    it('rejects out-of-range focal point before any persistence', async () => {
      await expect(
        service.createEvent(mockAccount, { calendarId: 'cal-1', mediaFocalPointX: 5 }),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects out-of-range zoom before any persistence', async () => {
      await expect(
        service.createEvent(mockAccount, { calendarId: 'cal-1', mediaZoom: 0 }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('updateEvent media transform validation', () => {
    const validUuid = '11111111-1111-4111-8111-111111111111';

    it('rejects out-of-range focal point before any persistence', async () => {
      await expect(
        service.updateEvent(mockAccount, validUuid, { mediaFocalPointY: -2 }),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects out-of-range zoom before any persistence', async () => {
      await expect(
        service.updateEvent(mockAccount, validUuid, { mediaZoom: 0.2 }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('schedule byDay validation', () => {
    const validUuid = '11111111-1111-4111-8111-111111111111';
    const badSchedules = [{ frequency: 'monthly', byDay: ['6MO'] }];

    it('createEvent rejects an unreachable ordinal before persistence', async () => {
      await expect(
        service.createEvent(mockAccount, { calendarId: 'cal-1', schedules: badSchedules }),
      ).rejects.toThrow(ValidationError);
    });

    it('updateEvent rejects an unreachable ordinal before persistence', async () => {
      await expect(
        service.updateEvent(mockAccount, validUuid, { schedules: badSchedules }),
      ).rejects.toThrow(ValidationError);
    });

    it('reports the offending schedule under fields.schedules', () => {
      try {
        validateSchedulesByDay([{ frequency: 'weekly', byDay: ['MO'] }, { frequency: 'monthly', byDay: ['0MO'] }]);
        expect.unreachable();
      }
      catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).message).toContain('schedules[1].byDay');
        expect((e as ValidationError).fields?.schedules).toHaveLength(1);
      }
    });

    it('accepts valid rules, one-offs with byDay, and non-array input', () => {
      expect(() => validateSchedulesByDay([{ frequency: 'monthly', byDay: ['5MO'] }])).not.toThrow();
      expect(() => validateSchedulesByDay([{ byDay: ['6MO'] }])).not.toThrow();
      expect(() => validateSchedulesByDay(undefined)).not.toThrow();
    });
  });
  describe('schedule end-before-start validation', () => {
    const validUuid = '11111111-1111-4111-8111-111111111111';
    const bad = [{ start: '2026-12-01T10:00:00.000Z', eventEndTime: '2026-12-01T09:00:00.000Z' }];

    it('rejects an end before the start, naming the schedule', () => {
      try {
        validateSchedulesEndTime([{ start: '2026-12-01T10:00:00.000Z' }, ...bad]);
        expect.unreachable();
      }
      catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).message).toContain('schedules[1].eventEndTime');
        expect((e as ValidationError).fields?.schedules).toEqual(['end is before start']);
      }
    });

    it('allows equal, missing, exclusion, next-day, and recurrence-until before start', () => {
      expect(() => validateSchedulesEndTime([
        { start: '2026-12-01T10:00:00.000Z', eventEndTime: '2026-12-01T10:00:00.000Z' },
        { start: '2026-12-01T10:00:00.000Z' },
        { start: '2026-12-01T10:00:00.000Z', eventEndTime: '2026-12-01T09:00:00.000Z', isException: true },
        { start: '2026-12-01T22:00:00.000Z', eventEndTime: '2026-12-02T01:00:00.000Z' },
        { start: '2026-12-01T10:00:00.000Z', end: '2026-11-01T10:00:00.000Z', frequency: 'weekly' },
      ])).not.toThrow();
      expect(() => validateSchedulesEndTime(undefined)).not.toThrow();
    });

    it('createEvent rejects end before start', async () => {
      await expect(
        service.createEvent(mockAccount, { calendarId: 'cal-1', schedules: bad }),
      ).rejects.toThrow(ValidationError);
    });

    it('updateEvent rejects end before start', async () => {
      await expect(
        service.updateEvent(mockAccount, validUuid, { schedules: bad }),
      ).rejects.toThrow(ValidationError);
    });
  });
});
