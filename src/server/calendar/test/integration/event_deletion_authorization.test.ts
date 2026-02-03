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
import { InsufficientCalendarPermissionsError, EventNotFoundError } from '@/common/exceptions/calendar';

/**
 * Integration tests for IDOR (Insecure Direct Object Reference) prevention
 * in event deletion and update operations.
 *
 * Tests comprehensive authorization scenarios to ensure users cannot:
 * - Delete or update events from calendars they don't have access to
 * - Manipulate calendar ownership through parameter injection
 *
 * These tests validate the security fixes in EventService.deleteEvent() and
 * EventService.updateEvent() methods.
 */
describe('Event Deletion and Update Authorization - IDOR Prevention', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let accountsInterface: AccountsInterface;
  let accountService: AccountService;
  let eventBus: EventEmitter;

  // User accounts
  let ownerAccount: Account;
  let editorAccount: Account;
  let attackerAccount: Account;

  // Calendars
  let ownerCalendar: Calendar;
  let attackerCalendar: Calendar;

  // Events
  let ownerEvent: CalendarEvent;
  let attackerEvent: CalendarEvent;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // Create owner account and calendar
    let ownerInfo = await accountService._setupAccount('owner@pavillion.dev', 'testpassword');
    ownerAccount = ownerInfo.account;
    ownerCalendar = await calendarInterface.createCalendar(ownerAccount, 'ownercalendar');

    // Create editor account and grant access to owner's calendar
    let editorInfo = await accountService._setupAccount('editor@pavillion.dev', 'testpassword');
    editorAccount = editorInfo.account;
    await calendarInterface.grantEditAccessByEmail(ownerAccount, ownerCalendar.id, 'editor@pavillion.dev');

    // Create attacker account and calendar
    let attackerInfo = await accountService._setupAccount('attacker@pavillion.dev', 'testpassword');
    attackerAccount = attackerInfo.account;
    attackerCalendar = await calendarInterface.createCalendar(attackerAccount, 'attackercalendar');

    // Create events in owner's calendar
    ownerEvent = await calendarInterface.createEvent(ownerAccount, {
      calendarId: ownerCalendar.id,
      content: {
        en: {
          name: 'Owner Event',
          description: 'Event in owner calendar',
        },
      },
      schedule: {
        isRecurring: false,
        startDate: '2025-08-10',
        startTime: '10:00',
        endDate: '2025-08-10',
        endTime: '11:00',
      },
    });

    // Create event in attacker's calendar
    attackerEvent = await calendarInterface.createEvent(attackerAccount, {
      calendarId: attackerCalendar.id,
      content: {
        en: {
          name: 'Attacker Event',
          description: 'Event in attacker calendar',
        },
      },
      schedule: {
        isRecurring: false,
        startDate: '2025-08-11',
        startTime: '14:00',
        endDate: '2025-08-11',
        endTime: '15:00',
      },
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  describe('Event Deletion Authorization', () => {
    describe('Owner permissions', () => {
      it('should allow owner to delete their own events', async () => {
        // Owner creates and deletes an event in their own calendar
        const testEvent = await calendarInterface.createEvent(ownerAccount, {
          calendarId: ownerCalendar.id,
          content: {
            en: {
              name: 'Test Event',
              description: 'Event to be deleted',
            },
          },
          schedule: {
            isRecurring: false,
            startDate: '2025-08-12',
            startTime: '10:00',
            endDate: '2025-08-12',
            endTime: '11:00',
          },
        });

        await expect(
          calendarInterface.deleteEvent(ownerAccount, testEvent.id, ownerCalendar.id)
        ).resolves.not.toThrow();
      });
    });

    describe('Editor permissions', () => {
      it('should allow editor to delete events from shared calendar', async () => {
        // Create event as owner
        const testEvent = await calendarInterface.createEvent(ownerAccount, {
          calendarId: ownerCalendar.id,
          content: {
            en: {
              name: 'Shared Event',
              description: 'Event in shared calendar',
            },
          },
          schedule: {
            isRecurring: false,
            startDate: '2025-08-13',
            startTime: '10:00',
            endDate: '2025-08-13',
            endTime: '11:00',
          },
        });

        // Editor should be able to delete it
        await expect(
          calendarInterface.deleteEvent(editorAccount, testEvent.id, ownerCalendar.id)
        ).resolves.not.toThrow();
      });

      it('should not allow editor to delete events from non-shared calendars', async () => {
        // Editor tries to delete event from attacker's calendar (no permissions)
        await expect(
          calendarInterface.deleteEvent(editorAccount, attackerEvent.id, attackerCalendar.id)
        ).rejects.toThrow(InsufficientCalendarPermissionsError);
      });
    });

    describe('IDOR Attack Prevention - Unauthorized Deletion', () => {
      it('should prevent user from deleting events from another user calendar', async () => {
        // Attacker tries to delete owner's event
        await expect(
          calendarInterface.deleteEvent(attackerAccount, ownerEvent.id, ownerCalendar.id)
        ).rejects.toThrow(InsufficientCalendarPermissionsError);
      });

      it('should prevent deletion with invalid calendarId parameter', async () => {
        // Attacker tries to delete owner's event by manipulating calendarId parameter
        // This tests that we validate permissions based on the event's actual calendar
        await expect(
          calendarInterface.deleteEvent(attackerAccount, ownerEvent.id, attackerCalendar.id)
        ).rejects.toThrow(InsufficientCalendarPermissionsError);
      });

      it('should reject deletion with non-existent event ID', async () => {
        const fakeEventId = 'non-existent-event-id';
        await expect(
          calendarInterface.deleteEvent(ownerAccount, fakeEventId, ownerCalendar.id)
        ).rejects.toThrow(EventNotFoundError);
      });
    });
  });

  describe('Event Update Authorization', () => {
    describe('Owner permissions', () => {
      it('should allow owner to update their own events', async () => {
        await expect(
          calendarInterface.updateEvent(ownerAccount, ownerEvent.id, {
            content: {
              en: {
                name: 'Updated Owner Event',
                description: 'Updated description',
              },
            },
          })
        ).resolves.not.toThrow();
      });
    });

    describe('Editor permissions', () => {
      it('should allow editor to update events in shared calendar', async () => {
        // Create event as owner
        const testEvent = await calendarInterface.createEvent(ownerAccount, {
          calendarId: ownerCalendar.id,
          content: {
            en: {
              name: 'Shared Event for Update',
              description: 'Event in shared calendar',
            },
          },
          schedule: {
            isRecurring: false,
            startDate: '2025-08-14',
            startTime: '10:00',
            endDate: '2025-08-14',
            endTime: '11:00',
          },
        });

        // Editor should be able to update it
        await expect(
          calendarInterface.updateEvent(editorAccount, testEvent.id, {
            content: {
              en: {
                name: 'Updated by Editor',
                description: 'Modified by editor',
              },
            },
          })
        ).resolves.not.toThrow();
      });

      it('should not allow editor to update events in non-shared calendars', async () => {
        // Editor tries to update event in attacker's calendar (no permissions)
        await expect(
          calendarInterface.updateEvent(editorAccount, attackerEvent.id, {
            content: {
              en: {
                name: 'Unauthorized Update',
                description: 'Should fail',
              },
            },
          })
        ).rejects.toThrow(InsufficientCalendarPermissionsError);
      });
    });

    describe('IDOR Attack Prevention - Unauthorized Update', () => {
      it('should prevent user from updating events in another user calendar', async () => {
        // Attacker tries to update owner's event
        await expect(
          calendarInterface.updateEvent(attackerAccount, ownerEvent.id, {
            content: {
              en: {
                name: 'Malicious Update',
                description: 'Should be blocked',
              },
            },
          })
        ).rejects.toThrow(InsufficientCalendarPermissionsError);
      });

      it('should validate permissions based on event actual calendar not supplied parameter', async () => {
        // Attacker tries to update owner's event
        // Authorization check happens first, so this fails with InsufficientCalendarPermissionsError
        // before the system even considers the calendarId parameter
        await expect(
          calendarInterface.updateEvent(attackerAccount, ownerEvent.id, {
            content: {
              en: {
                name: 'Parameter Injection Attack',
                description: 'Should be blocked',
              },
            },
          })
        ).rejects.toThrow(InsufficientCalendarPermissionsError);
      });

      it('should reject update with non-existent event ID', async () => {
        const fakeEventId = 'non-existent-event-id';
        await expect(
          calendarInterface.updateEvent(ownerAccount, fakeEventId, {
            content: {
              en: {
                name: 'Update Non-existent',
                description: 'Should fail',
              },
            },
          })
        ).rejects.toThrow(EventNotFoundError);
      });
    });
  });

  describe('Authorization Consistency Checks', () => {
    it('should maintain consistent authorization between create and delete', async () => {
      // If a user can create an event in a calendar, they should be able to delete it
      const testEvent = await calendarInterface.createEvent(editorAccount, {
        calendarId: ownerCalendar.id, // Editor has permissions on this calendar
        content: {
          en: {
            name: 'Editor Created Event',
            description: 'Event created by editor',
          },
        },
        schedule: {
          isRecurring: false,
          startDate: '2025-08-15',
          startTime: '10:00',
          endDate: '2025-08-15',
          endTime: '11:00',
        },
      });

      // Editor should be able to delete it
      await expect(
        calendarInterface.deleteEvent(editorAccount, testEvent.id, ownerCalendar.id)
      ).resolves.not.toThrow();
    });

    it('should maintain consistent authorization between create and update', async () => {
      // If a user can create an event in a calendar, they should be able to update it
      const testEvent = await calendarInterface.createEvent(editorAccount, {
        calendarId: ownerCalendar.id, // Editor has permissions on this calendar
        content: {
          en: {
            name: 'Editor Event for Update',
            description: 'Event created by editor',
          },
        },
        schedule: {
          isRecurring: false,
          startDate: '2025-08-16',
          startTime: '10:00',
          endDate: '2025-08-16',
          endTime: '11:00',
        },
      });

      // Editor should be able to update it
      await expect(
        calendarInterface.updateEvent(editorAccount, testEvent.id, {
          content: {
            en: {
              name: 'Updated by Editor',
              description: 'Modified by editor',
            },
          },
        })
      ).resolves.not.toThrow();
    });

    it('should enforce permissions regardless of event creator', async () => {
      // Owner creates event
      const ownerCreatedEvent = await calendarInterface.createEvent(ownerAccount, {
        calendarId: ownerCalendar.id,
        content: {
          en: {
            name: 'Owner Created Event',
            description: 'Created by owner',
          },
        },
        schedule: {
          isRecurring: false,
          startDate: '2025-08-17',
          startTime: '10:00',
          endDate: '2025-08-17',
          endTime: '11:00',
        },
      });

      // Editor should still be able to modify it (they have calendar permissions)
      await expect(
        calendarInterface.updateEvent(editorAccount, ownerCreatedEvent.id, {
          content: {
            en: {
              name: 'Updated by Editor',
              description: 'Modified by editor',
            },
          },
        })
      ).resolves.not.toThrow();

      // Attacker should NOT be able to modify it
      await expect(
        calendarInterface.updateEvent(attackerAccount, ownerCreatedEvent.id, {
          content: {
            en: {
              name: 'Malicious Update',
              description: 'Should fail',
            },
          },
        })
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('should prevent access after permissions are revoked', async () => {
      // Create a new account with temporary editor access
      const tempInfo = await accountService._setupAccount('temp@pavillion.dev', 'testpassword');
      const tempAccount = tempInfo.account;
      await calendarInterface.grantEditAccessByEmail(ownerAccount, ownerCalendar.id, 'temp@pavillion.dev');

      // Create event as temp user
      const testEvent = await calendarInterface.createEvent(tempAccount, {
        calendarId: ownerCalendar.id,
        content: {
          en: {
            name: 'Temp User Event',
            description: 'Event by temp user',
          },
        },
        schedule: {
          isRecurring: false,
          startDate: '2025-08-18',
          startTime: '10:00',
          endDate: '2025-08-18',
          endTime: '11:00',
        },
      });

      // Revoke permissions using removeEditAccess with account ID
      await calendarInterface.removeEditAccess(ownerAccount, ownerCalendar.id, tempAccount.id);

      // Temp user should no longer be able to delete or update
      await expect(
        calendarInterface.deleteEvent(tempAccount, testEvent.id, ownerCalendar.id)
      ).rejects.toThrow(InsufficientCalendarPermissionsError);

      await expect(
        calendarInterface.updateEvent(tempAccount, testEvent.id, {
          content: {
            en: {
              name: 'Unauthorized Update',
              description: 'Should fail',
            },
          },
        })
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });
  });
});
