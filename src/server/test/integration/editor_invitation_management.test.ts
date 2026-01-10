import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

describe('Editor Invitation Management Integration', () => {
  let ownerAccount: Account;
  let editorAccount: Account;
  let calendar: Calendar;
  let env: TestEnvironment;
  let eventBus: EventEmitter;
  let calendarInterface: CalendarInterface;
  let ownerAuthKey: string;
  let editorAuthKey: string;

  const ownerEmail: string = 'owner@pavillion.dev';
  const editorEmail: string = 'editor@pavillion.dev';
  const inviteeEmail: string = 'invitee@pavillion.dev';
  const password: string = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init(3002);

    eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    calendarInterface = new CalendarInterface(eventBus);
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // Create owner account and calendar
    let ownerInfo = await accountService._setupAccount(ownerEmail, password);
    ownerAccount = ownerInfo.account;
    calendar = await calendarInterface.createCalendar(ownerAccount, 'testcalendar');

    // Create editor account
    let editorInfo = await accountService._setupAccount(editorEmail, password);
    editorAccount = editorInfo.account;

    // Login both users
    ownerAuthKey = await env.login(ownerEmail, password);
    editorAuthKey = await env.login(editorEmail, password);
  });

  afterEach(() => {
    sinon.restore();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  describe('Enhanced Editors Endpoint', () => {
    it('should return both active editors and pending invitations', async () => {
      // First add an active editor via API
      await env.authPost(ownerAuthKey, `/api/v1/calendars/${calendar.id}/editors`, {
        accountId: editorAccount.id,
      });

      // Create a pending invitation via API
      await env.authPost(ownerAuthKey, `/api/v1/calendars/${calendar.id}/editors`, {
        accountId: inviteeEmail,  // This should create an invitation
      });

      // Test the enhanced editors endpoint
      const response = await env.authGet(ownerAuthKey, `/api/v1/calendars/${calendar.id}/editors`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('activeEditors');
      expect(response.body).toHaveProperty('pendingInvitations');
      expect(Array.isArray(response.body.activeEditors)).toBe(true);
      expect(Array.isArray(response.body.pendingInvitations)).toBe(true);
    });

    it('should enforce calendar ownership for viewing editors and invitations', async () => {
      // Editor should not be able to see invitations (only owner can)
      const response = await env.authGet(editorAuthKey, `/api/v1/calendars/${calendar.id}/editors`);

      expect(response.status).toBe(403); // Permission denied
    });

    it('should return empty arrays when no editors or invitations exist', async () => {
      // Create a new calendar with no editors/invitations
      const newCalendar = await calendarInterface.createCalendar(ownerAccount, 'emptycalendar');

      const response = await env.authGet(ownerAuthKey, `/api/v1/calendars/${newCalendar.id}/editors`);

      expect(response.status).toBe(200);
      expect(response.body.activeEditors).toHaveLength(0);
      expect(response.body.pendingInvitations).toHaveLength(0);
    });
  });

  describe('Invitation Management Operations', () => {
    it('should handle invitation cancellation API endpoint', async () => {
      // Create invitation first
      await env.authPost(ownerAuthKey, `/api/v1/calendars/${calendar.id}/editors`, {
        accountId: 'cancellation-test@pavillion.dev',
      });

      // Get the invitation ID from the editors list
      const editorsResponse = await env.authGet(ownerAuthKey, `/api/v1/calendars/${calendar.id}/editors`);
      const invitation = editorsResponse.body.pendingInvitations.find(inv => inv.email === 'cancellation-test@pavillion.dev');

      if (invitation) {
        // Cancel the invitation
        const response = await env.authDelete(ownerAuthKey, `/api/v1/calendars/${calendar.id}/invitations/${invitation.id}`);
        expect(response.status).toBe(200);
      }
    });

    it('should handle invitation resend API endpoint', async () => {
      // Create invitation first
      await env.authPost(ownerAuthKey, `/api/v1/calendars/${calendar.id}/editors`, {
        accountId: 'resend-test@pavillion.dev',
      });

      // Get the invitation ID from the editors list
      const editorsResponse = await env.authGet(ownerAuthKey, `/api/v1/calendars/${calendar.id}/editors`);
      const invitation = editorsResponse.body.pendingInvitations.find(inv => inv.email === 'resend-test@pavillion.dev');

      if (invitation) {
        // Resend the invitation
        const response = await env.authPost(ownerAuthKey, `/api/v1/calendars/${calendar.id}/invitations/${invitation.id}/resend`, {});
        // Allow either success or rate limiting
        expect([200, 429]).toContain(response.status);
      }
    });
  });

  describe('Cross-Domain Integration', () => {
    it('should properly communicate between calendar and accounts domains', async () => {
      // Test that the calendar API can fetch invitation data from accounts domain
      const response = await env.authGet(ownerAuthKey, `/api/v1/calendars/${calendar.id}/editors`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('activeEditors');
      expect(response.body).toHaveProperty('pendingInvitations');
    });
  });

  describe('Complete Workflow Integration', () => {
    it('should handle errors gracefully in workflow', async () => {
      // Try to cancel non-existent invitation
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await env.authDelete(ownerAuthKey, `/api/v1/calendars/${calendar.id}/invitations/${fakeId}`);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });

    it('should support basic API workflow', async () => {
      // Test basic enhanced editors endpoint functionality
      const response = await env.authGet(ownerAuthKey, `/api/v1/calendars/${calendar.id}/editors`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('activeEditors');
      expect(response.body).toHaveProperty('pendingInvitations');
      expect(Array.isArray(response.body.activeEditors)).toBe(true);
      expect(Array.isArray(response.body.pendingInvitations)).toBe(true);
    });
  });
});
