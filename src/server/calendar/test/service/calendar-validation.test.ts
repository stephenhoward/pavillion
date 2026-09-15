import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import CalendarService from '@/server/calendar/service/calendar';
import { ValidationError } from '@/common/exceptions/base';
import { InvalidUrlNameError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEntity } from '@/server/calendar/entity/calendar';

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

    // A calendar lives at the domain root, so a name that matches a top-level
    // route would shadow it. These reach InvalidUrlNameError before any
    // database access, so no stubs are needed.
    it.each(['admin', 'discover', 'view', 'api', 'Admin'])(
      'should throw InvalidUrlNameError when urlName is the reserved segment %s',
      async (urlName) => {
        await expect(
          service.createCalendar(mockAccount, urlName, 'Test Calendar'),
        ).rejects.toThrow(InvalidUrlNameError);
      },
    );

    // Supported locale codes are reserved too (/:lang/:calendarName would make
    // such a calendar unroutable); every current code is also too short to pass
    // the shape rule, so either check alone would reject this.
    it('should throw InvalidUrlNameError when urlName is a locale code', async () => {
      await expect(
        service.createCalendar(mockAccount, 'es', 'Test Calendar'),
      ).rejects.toThrow(InvalidUrlNameError);
    });
  });

  describe('setUrlName', () => {
    let sandbox: sinon.SinonSandbox;
    let calendar: Calendar;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      calendar = new Calendar('test-calendar-id', 'testcalendar');
      sandbox.stub(service, 'userCanModifyCalendar').resolves(true);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it.each(['admin', 'discover', 'view', 'api', 'Admin', 'es'])(
      'should throw InvalidUrlNameError when renaming to the reserved name %s',
      async (urlName) => {
        await expect(
          service.setUrlName(mockAccount, calendar, urlName),
        ).rejects.toThrow(InvalidUrlNameError);
      },
    );

    it('should pass validation for an ordinary name that merely contains a reserved word', async () => {
      // Gets past validation and fails on the (stubbed-away) calendar lookup
      // instead; the point is that validation did not reject the name.
      sandbox.stub(CalendarEntity, 'findByPk').resolves(null);

      await expect(
        service.setUrlName(mockAccount, calendar, 'admins-only'),
      ).rejects.toThrow(CalendarNotFoundError);
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

    it('should throw ValidationError when defaultEventImageId is not a valid UUID', async () => {
      await expect(
        service.updateCalendarSettings(mockAccount, 'cal-123', { defaultEventImageId: 'not-a-uuid' }),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.updateCalendarSettings(mockAccount, 'cal-123', { defaultEventImageId: 'not-a-uuid' }),
      ).rejects.toThrow('defaultEventImageId must be a valid UUID or null');
    });

    it('should not throw ValidationError when defaultEventImageId is null', async () => {
      // null means "clear the image" - should pass validation and proceed to calendar lookup
      // which will fail with CalendarNotFoundError since we have no stubs, but that's fine
      // -- the point is it doesn't throw ValidationError
      await expect(
        service.updateCalendarSettings(mockAccount, 'cal-123', { defaultEventImageId: null }),
      ).rejects.not.toThrow(ValidationError);
    });
  });
});
