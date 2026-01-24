import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import { InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';

describe('Local Person Editor Workflow - Integration', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let accountsInterface: AccountsInterface;
  let accountService: AccountService;
  let ownerAccount: Account;
  let editorAccount: Account;
  let nonEditorAccount: Account;
  let testCalendar: Calendar;
  let eventBus: EventEmitter;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // Create owner account
    let ownerInfo = await accountService._setupAccount('owner@pavillion.dev', 'testpassword');
    ownerAccount = ownerInfo.account;

    // Create editor account
    let editorInfo = await accountService._setupAccount('editor@pavillion.dev', 'testpassword');
    editorAccount = editorInfo.account;

    // Create non-editor account
    let nonEditorInfo = await accountService._setupAccount('noneditor@pavillion.dev', 'testpassword');
    nonEditorAccount = nonEditorInfo.account;

    // Create test calendar owned by owner
    testCalendar = await calendarInterface.createCalendar(ownerAccount, 'testeditorcalendar');
  });

  afterAll(async () => {
    await env.cleanup();
  });

  describe('Owner invites editor by email', () => {
    it('should grant editor access to an existing user', async () => {
      const result = await calendarInterface.grantEditAccessByEmail(
        ownerAccount,
        testCalendar.id,
        'editor@pavillion.dev',
      );

      expect(result.type).toBe('editor');
      expect(result.data.email).toBe('editor@pavillion.dev');
      expect(result.data.calendarId).toBe(testCalendar.id);
    });

    it('should show editor in calendar editors list', async () => {
      const editorsResponse = await calendarInterface.listCalendarEditorsWithInvitations(
        ownerAccount,
        testCalendar.id,
      );

      expect(editorsResponse.activeEditors).toHaveLength(1);
      expect(editorsResponse.activeEditors[0].email).toBe('editor@pavillion.dev');
    });

    it('should not allow granting access to self', async () => {
      await expect(
        calendarInterface.grantEditAccessByEmail(ownerAccount, testCalendar.id, 'owner@pavillion.dev'),
      ).rejects.toThrow();
    });

    it('should not allow duplicate editor grants', async () => {
      await expect(
        calendarInterface.grantEditAccessByEmail(ownerAccount, testCalendar.id, 'editor@pavillion.dev'),
      ).rejects.toThrow();
    });
  });

  describe('Editor can manage events', () => {
    let editorCreatedEvent: CalendarEvent;

    it('should allow editor to create events', async () => {
      editorCreatedEvent = await calendarInterface.createEvent(editorAccount, {
        calendarId: testCalendar.id,
        content: {
          en: {
            name: 'Editor Created Event',
            description: 'Event created by editor user',
          },
        },
        start_date: '2025-08-10',
        start_time: '10:00',
        end_date: '2025-08-10',
        end_time: '11:00',
      });

      expect(editorCreatedEvent).toBeDefined();
      expect(editorCreatedEvent.content('en').name).toBe('Editor Created Event');
    });

    it('should allow editor to edit events', async () => {
      const updatedEvent = await calendarInterface.updateEvent(editorAccount, editorCreatedEvent.id, {
        content: {
          en: {
            name: 'Updated Event Name',
            description: 'Updated by editor',
          },
        },
      });

      expect(updatedEvent.content('en').name).toBe('Updated Event Name');
    });

    it('should allow editor to delete events', async () => {
      await expect(
        calendarInterface.deleteEvent(editorAccount, editorCreatedEvent.id),
      ).resolves.not.toThrow();
    });

    it('should verify editor has edit permissions', async () => {
      const canModify = await calendarInterface.userCanModifyCalendar(editorAccount, testCalendar);
      expect(canModify).toBe(true);
    });
  });

  describe('Editor limitations', () => {
    it('should not allow editor to manage other editors', async () => {
      await expect(
        calendarInterface.grantEditAccessByEmail(editorAccount, testCalendar.id, 'noneditor@pavillion.dev'),
      ).rejects.toThrow(CalendarEditorPermissionError);
    });

    it('should not allow editor to revoke other editors', async () => {
      // Grant access to non-editor account first so editor has someone else to try to revoke
      await calendarInterface.grantEditAccessByEmail(ownerAccount, testCalendar.id, 'noneditor@pavillion.dev');

      // Now try to have editor revoke the other editor's access
      await expect(
        calendarInterface.removeEditAccess(editorAccount, testCalendar.id, nonEditorAccount.id),
      ).rejects.toThrow(CalendarEditorPermissionError);

      // Clean up - owner revokes the second editor
      await calendarInterface.removeEditAccess(ownerAccount, testCalendar.id, nonEditorAccount.id);
    });

    it('should not show calendar in non-editor editable calendars', async () => {
      const editableCalendars = await calendarInterface.editableCalendarsForUser(nonEditorAccount);
      const hasAccess = editableCalendars.some((cal) => cal.id === testCalendar.id);
      expect(hasAccess).toBe(false);
    });

    it('should not allow non-editor to create events', async () => {
      await expect(
        calendarInterface.createEvent(nonEditorAccount, {
          calendarId: testCalendar.id,
          content: {
            en: {
              name: 'Should Fail',
              description: 'Non-editor trying to create event',
            },
          },
          start_date: '2025-08-11',
          start_time: '10:00',
          end_date: '2025-08-11',
          end_time: '11:00',
        }),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });
  });

  describe('Owner can revoke editor access', () => {
    it('should allow owner to revoke editor access', async () => {
      const result = await calendarInterface.removeEditAccess(
        ownerAccount,
        testCalendar.id,
        editorAccount.id,
      );

      expect(result).toBe(true);
    });

    it('should remove editor from editors list', async () => {
      const editorsResponse = await calendarInterface.listCalendarEditorsWithInvitations(
        ownerAccount,
        testCalendar.id,
      );

      expect(editorsResponse.activeEditors).toHaveLength(0);
    });
  });

  describe('Revoked editor loses access immediately', () => {
    it('should not allow revoked editor to create events', async () => {
      await expect(
        calendarInterface.createEvent(editorAccount, {
          calendarId: testCalendar.id,
          content: {
            en: {
              name: 'Should Fail After Revocation',
              description: 'Revoked editor trying to create event',
            },
          },
          start_date: '2025-08-12',
          start_time: '10:00',
          end_date: '2025-08-12',
          end_time: '11:00',
        }),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('should verify revoked editor has no permissions', async () => {
      const canModify = await calendarInterface.userCanModifyCalendar(editorAccount, testCalendar);
      expect(canModify).toBe(false);
    });

    it('should not show calendar in revoked editor editable calendars', async () => {
      const editableCalendars = await calendarInterface.editableCalendarsForUser(editorAccount);
      const hasAccess = editableCalendars.some((cal) => cal.id === testCalendar.id);
      expect(hasAccess).toBe(false);
    });
  });

  describe('editableCalendarsWithRoleForUser shows correct role', () => {
    it('should show owner role for calendar owner', async () => {
      const calendarsWithRole = await calendarInterface.editableCalendarsWithRoleForUser(ownerAccount);
      const testCalInfo = calendarsWithRole.find((cal) => cal.calendar.id === testCalendar.id);

      expect(testCalInfo).toBeDefined();
      expect(testCalInfo!.role).toBe('owner');
    });

    it('should show editor role for granted editor', async () => {
      // Re-grant access for this test
      await calendarInterface.grantEditAccessByEmail(ownerAccount, testCalendar.id, 'editor@pavillion.dev');

      const calendarsWithRole = await calendarInterface.editableCalendarsWithRoleForUser(editorAccount);
      const testCalInfo = calendarsWithRole.find((cal) => cal.calendar.id === testCalendar.id);

      expect(testCalInfo).toBeDefined();
      expect(testCalInfo!.role).toBe('editor');
    });
  });
});
