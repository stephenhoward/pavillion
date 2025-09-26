import { describe, it, expect, afterEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { AccountEntity } from '@/server/common/entity/account';
import AccountInvitationEntity from '@/server/accounts/entity/account_invitation';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

describe('AccountInvitationEntity with calendar_id support', () => {
  let sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  describe('calendar_id column', () => {
    it('should allow null calendar_id for admin invitations', async () => {
      // Mock entity creation without calendar_id (existing functionality)
      const mockAccountEntity = {
        id: 'admin_id',
        toModel: () => new Account('admin_id', 'admin', 'admin@test.com'),
      };

      const invitation = AccountInvitationEntity.build({
        id: 'invitation_id',
        invited_by: 'admin_id',
        email: 'user@test.com',
        message: 'Welcome!',
        invitation_code: 'ABC123',
        calendar_id: null, // Explicitly null for admin invitations
      });

      invitation.inviter = mockAccountEntity as AccountEntity;

      expect(invitation.calendar_id).toBeNull();
      expect(invitation.email).toBe('user@test.com');

      // Verify toModel() works without calendar_id
      const model = invitation.toModel();
      expect(model.email).toBe('user@test.com');
    });

    it('should support calendar_id for calendar editor invitations', async () => {
      // Mock entities for calendar editor invitation
      const mockAccountEntity = {
        id: 'owner_id',
        toModel: () => new Account('owner_id', 'owner', 'owner@test.com'),
      };

      const invitation = AccountInvitationEntity.build({
        id: 'invitation_id',
        invited_by: 'owner_id',
        email: 'editor@test.com',
        message: 'Please join as editor!',
        invitation_code: 'XYZ789',
        calendar_id: 'calendar_123', // Calendar editor invitation
      });

      invitation.inviter = mockAccountEntity as AccountEntity;

      expect(invitation.calendar_id).toBe('calendar_123');
      expect(invitation.email).toBe('editor@test.com');

      // Verify toModel() works with calendar_id
      const model = invitation.toModel();
      expect(model.email).toBe('editor@test.com');
      expect(model.calendarId).toBe('calendar_123');
    });

    it('should maintain backward compatibility with existing invitations', async () => {
      // Test that existing invitation records (without calendar_id) still work
      const mockAccountEntity = {
        id: 'admin_id',
        toModel: () => new Account('admin_id', 'admin', 'admin@test.com'),
      };

      const invitation = AccountInvitationEntity.build({
        id: 'old_invitation_id',
        invited_by: 'admin_id',
        email: 'olduser@test.com',
        message: 'Old invitation',
        invitation_code: 'OLD123',
        // Note: no calendar_id field - simulating existing data
      });

      invitation.inviter = mockAccountEntity as AccountEntity;

      expect(invitation.calendar_id).toBeUndefined();
      expect(invitation.email).toBe('olduser@test.com');

      // Existing functionality should continue to work
      const model = invitation.toModel();
      expect(model.email).toBe('olduser@test.com');
    });
  });

  describe('foreign key relationship to calendar', () => {
    it('should establish proper relationship to CalendarEntity', async () => {
      // Test that the foreign key relationship works
      const invitation = AccountInvitationEntity.build({
        id: 'invitation_id',
        invited_by: 'owner_id',
        email: 'editor@test.com',
        message: 'Join calendar!',
        invitation_code: 'REL123',
        calendar_id: 'calendar_456',
      });

      // Verify the calendar_id field exists and can be set
      expect(invitation.calendar_id).toBe('calendar_456');

      // The actual foreign key constraint will be tested through database operations
      // in integration tests, but we can verify the field structure here
      expect(invitation.getDataValue('calendar_id')).toBe('calendar_456');
    });
  });
});
