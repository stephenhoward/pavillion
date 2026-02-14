import { describe, it, expect, beforeEach } from 'vitest';
import CalendarService from '@/server/calendar/service/calendar';
import { ValidationError } from '@/common/exceptions/base';
import { Account } from '@/common/model/account';

describe('CalendarService - Validation', () => {
  let service: CalendarService;
  let mockAccount: Account;

  beforeEach(() => {
    service = new CalendarService();
    mockAccount = new Account('test-account-id');
    mockAccount.email = 'test@example.com';
  });

  describe('createCalendar', () => {
    it('should throw ValidationError when urlName is empty', async () => {
      await expect(
        service.createCalendar(mockAccount, '', 'Test Calendar'),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.createCalendar(mockAccount, '', 'Test Calendar'),
      ).rejects.toThrow('urlName is required');
    });

    it('should throw ValidationError when urlName is whitespace', async () => {
      await expect(
        service.createCalendar(mockAccount, '   ', 'Test Calendar'),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.createCalendar(mockAccount, '   ', 'Test Calendar'),
      ).rejects.toThrow('urlName is required');
    });
  });

  describe('updateCalendarSettings', () => {
    it('should throw ValidationError when calendarId is empty', async () => {
      await expect(
        service.updateCalendarSettings(mockAccount, '', {}),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.updateCalendarSettings(mockAccount, '', {}),
      ).rejects.toThrow('calendarId is required');
    });

    it('should throw ValidationError when defaultDateRange is invalid', async () => {
      await expect(
        service.updateCalendarSettings(mockAccount, 'cal-123', { defaultDateRange: 'invalid' as any }),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.updateCalendarSettings(mockAccount, 'cal-123', { defaultDateRange: 'invalid' as any }),
      ).rejects.toThrow('Invalid defaultDateRange. Must be one of: 1week, 2weeks, 1month');
    });
  });
});
