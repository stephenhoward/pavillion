import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarService from '@/server/calendar/service/calendar';
import { CalendarMemberEntity } from '@/server/calendar/entity/calendar_member';
import { CALENDAR_BUS_EVENTS } from '@/server/calendar/events/types';

describe('CalendarService - Editor Permissions', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let service: CalendarService;
  let ownerAccount: Account;
  let editorAccount: Account;
  let calendar: Calendar;

  beforeEach(() => {
    service = new CalendarService();

    // Create test accounts
    ownerAccount = new Account('owner-id');
    ownerAccount.username = 'calendarowner';
    ownerAccount.email = 'owner@example.com';

    editorAccount = new Account('editor-id');
    editorAccount.username = 'editoruser';
    editorAccount.email = 'editor@example.com';

    // Create test calendar
    calendar = new Calendar('calendar-id', 'test-calendar');
    calendar.accountId = ownerAccount.id;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('grantEditorAccess', () => {
    it('should create CalendarMemberEntity editor record', async () => {
      // Stub getCalendar to return test calendar
      sandbox.stub(service, 'getCalendar').resolves(calendar);

      // Stub isCalendarOwner to return true for owner
      sandbox.stub(service, 'isCalendarOwner').resolves(true);

      // Stub CalendarMemberEntity.create
      const createStub = sandbox.stub(CalendarMemberEntity, 'create').resolves({
        id: 'member-record-id',
        calendar_id: calendar.id,
        account_id: editorAccount.id,
        role: 'editor',
        granted_by: ownerAccount.id,
      } as any);

      await service.grantEditorAccess(ownerAccount, calendar.id, editorAccount.id);

      expect(createStub.calledOnce).toBe(true);
      expect(createStub.firstCall.args[0]).toMatchObject({
        calendar_id: calendar.id,
        account_id: editorAccount.id,
        role: 'editor',
        granted_by: ownerAccount.id,
      });
    });

    it('should throw error if non-owner tries to grant access', async () => {
      // Stub getCalendar to return calendar owned by different account
      sandbox.stub(service, 'getCalendar').resolves(calendar);

      // editorAccount trying to grant access (not the owner)
      await expect(
        service.grantEditorAccess(editorAccount, calendar.id, 'some-other-user-id'),
      ).rejects.toThrow();
    });

    it('should throw error if calendar not found', async () => {
      sandbox.stub(service, 'getCalendar').resolves(null);

      await expect(
        service.grantEditorAccess(ownerAccount, 'nonexistent-calendar', editorAccount.id),
      ).rejects.toThrow();
    });

    it('should not allow granting access to self as editor', async () => {
      sandbox.stub(service, 'getCalendar').resolves(calendar);

      // Owner trying to add themselves as editor (they're already owner)
      await expect(
        service.grantEditorAccess(ownerAccount, calendar.id, ownerAccount.id),
      ).rejects.toThrow();
    });
  });

  describe('revokeEditorAccess', () => {
    it('should remove editor relationship via CalendarMemberEntity', async () => {
      sandbox.stub(service, 'getCalendar').resolves(calendar);

      // Stub isCalendarOwner to return true for owner
      sandbox.stub(service, 'isCalendarOwner').resolves(true);

      // Stub CalendarMemberEntity.destroy to return 1 (one record deleted)
      const destroyStub = sandbox.stub(CalendarMemberEntity, 'destroy').resolves(1);

      await service.revokeEditorAccess(ownerAccount, calendar.id, editorAccount.id);

      expect(destroyStub.calledOnce).toBe(true);
      expect(destroyStub.firstCall.args[0]).toMatchObject({
        where: {
          calendar_id: calendar.id,
          account_id: editorAccount.id,
          role: 'editor',
        },
      });
    });

    it('should throw error if non-owner tries to revoke access', async () => {
      sandbox.stub(service, 'getCalendar').resolves(calendar);

      await expect(
        service.revokeEditorAccess(editorAccount, calendar.id, 'some-user-id'),
      ).rejects.toThrow();
    });

    it('should throw error if editor relationship not found', async () => {
      sandbox.stub(service, 'getCalendar').resolves(calendar);
      sandbox.stub(service, 'isCalendarOwner').resolves(true);
      sandbox.stub(CalendarMemberEntity, 'destroy').resolves(0);

      await expect(
        service.revokeEditorAccess(ownerAccount, calendar.id, editorAccount.id),
      ).rejects.toThrow();
    });
  });

  describe('userCanEditCalendar', () => {
    it('should return true for calendar owner', async () => {
      // Stub CalendarMemberEntity.findOne to return an owner membership
      sandbox.stub(CalendarMemberEntity, 'findOne').resolves({
        calendar_id: calendar.id,
        account_id: ownerAccount.id,
        role: 'owner',
      } as any);

      const result = await service.userCanEditCalendar(ownerAccount.id, calendar.id);

      expect(result).toBe(true);
    });

    it('should return true for editors', async () => {
      // Stub CalendarMemberEntity.findOne to return an editor membership
      sandbox.stub(CalendarMemberEntity, 'findOne').resolves({
        calendar_id: calendar.id,
        account_id: editorAccount.id,
        role: 'editor',
      } as any);

      const result = await service.userCanEditCalendar(editorAccount.id, calendar.id);

      expect(result).toBe(true);
    });

    it('should return false for non-editors', async () => {
      const randomAccount = new Account('random-id');

      // Stub CalendarMemberEntity.findOne to return null (no membership)
      sandbox.stub(CalendarMemberEntity, 'findOne').resolves(null);

      const result = await service.userCanEditCalendar(randomAccount.id, calendar.id);

      expect(result).toBe(false);
    });

    it('should return false if calendar not found', async () => {
      // Stub CalendarMemberEntity.findOne to return null (no membership)
      sandbox.stub(CalendarMemberEntity, 'findOne').resolves(null);

      const result = await service.userCanEditCalendar(ownerAccount.id, 'nonexistent-calendar');

      expect(result).toBe(false);
    });
  });

  describe('listPersonEditors', () => {
    it('should return all editors with metadata', async () => {
      sandbox.stub(service, 'getCalendar').resolves(calendar);

      // Stub CalendarMemberEntity.findAll to return editor members with account and grantor
      const mockEditorMembers = [
        {
          id: 'member-1',
          calendar_id: calendar.id,
          account_id: 'editor-1-id',
          role: 'editor',
          granted_by: ownerAccount.id,
          account: {
            id: 'editor-1-id',
            username: 'editor1',
            email: 'editor1@example.com',
          },
          grantor: {
            id: ownerAccount.id,
            username: ownerAccount.username,
            email: ownerAccount.email,
          },
        },
        {
          id: 'member-2',
          calendar_id: calendar.id,
          account_id: 'editor-2-id',
          role: 'editor',
          granted_by: ownerAccount.id,
          account: {
            id: 'editor-2-id',
            username: 'editor2',
            email: 'editor2@example.com',
          },
          grantor: {
            id: ownerAccount.id,
            username: ownerAccount.username,
            email: ownerAccount.email,
          },
        },
      ];

      sandbox.stub(CalendarMemberEntity, 'findAll').resolves(mockEditorMembers as any);

      const editors = await service.listPersonEditors(calendar.id);

      expect(editors).toHaveLength(2);
      expect(editors[0]).toMatchObject({
        accountId: 'editor-1-id',
        username: 'editor1',
        email: 'editor1@example.com',
      });
      expect(editors[1]).toMatchObject({
        accountId: 'editor-2-id',
        username: 'editor2',
        email: 'editor2@example.com',
      });
    });

    it('should return empty array if no editors', async () => {
      sandbox.stub(service, 'getCalendar').resolves(calendar);
      sandbox.stub(CalendarMemberEntity, 'findAll').resolves([]);

      const editors = await service.listPersonEditors(calendar.id);

      expect(editors).toHaveLength(0);
    });

    it('should throw error if calendar not found', async () => {
      sandbox.stub(service, 'getCalendar').resolves(null);

      await expect(
        service.listCalendarEditors('nonexistent-calendar'),
      ).rejects.toThrow();
    });
  });

  describe('calendar bus events', () => {
    let eventBus: EventEmitter;
    let busService: CalendarService;

    beforeEach(() => {
      eventBus = new EventEmitter();
      busService = new CalendarService(undefined, undefined, eventBus);
    });

    it('should emit calendar:editor:invited when grantEditorAccess succeeds', async () => {
      sandbox.stub(busService, 'getCalendar').resolves(calendar);
      sandbox.stub(busService, 'isCalendarOwner').resolves(true);
      sandbox.stub(CalendarMemberEntity, 'create').resolves({} as any);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await busService.grantEditorAccess(ownerAccount, calendar.id, editorAccount.id);

      expect(emitSpy.calledWith(
        CALENDAR_BUS_EVENTS.EDITOR_INVITED,
        sinon.match({
          calendarId: calendar.id,
          accountId: editorAccount.id,
          grantedBy: ownerAccount.id,
        }),
      )).toBe(true);
    });

    it('should NOT emit calendar:editor:invited when grantEditorAccess fails permission check', async () => {
      sandbox.stub(busService, 'getCalendar').resolves(calendar);
      sandbox.stub(busService, 'isCalendarOwner').resolves(false);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await expect(
        busService.grantEditorAccess(editorAccount, calendar.id, 'some-other-id'),
      ).rejects.toThrow();

      expect(emitSpy.calledWith(CALENDAR_BUS_EVENTS.EDITOR_INVITED)).toBe(false);
    });

    it('should emit calendar:editor:revoked when revokeEditorAccess succeeds', async () => {
      sandbox.stub(busService, 'getCalendar').resolves(calendar);
      sandbox.stub(busService, 'isCalendarOwner').resolves(true);
      sandbox.stub(CalendarMemberEntity, 'destroy').resolves(1);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await busService.revokeEditorAccess(ownerAccount, calendar.id, editorAccount.id);

      expect(emitSpy.calledWith(
        CALENDAR_BUS_EVENTS.EDITOR_REVOKED,
        sinon.match({
          calendarId: calendar.id,
          accountId: editorAccount.id,
          revokedBy: ownerAccount.id,
        }),
      )).toBe(true);
    });

    it('should NOT emit calendar:editor:revoked when revokeEditorAccess deletes zero rows', async () => {
      sandbox.stub(busService, 'getCalendar').resolves(calendar);
      sandbox.stub(busService, 'isCalendarOwner').resolves(true);
      sandbox.stub(CalendarMemberEntity, 'destroy').resolves(0);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await expect(
        busService.revokeEditorAccess(ownerAccount, calendar.id, editorAccount.id),
      ).rejects.toThrow();

      expect(emitSpy.calledWith(CALENDAR_BUS_EVENTS.EDITOR_REVOKED)).toBe(false);
    });

    it('should emit calendar:editor:revoked when removeEditAccess succeeds', async () => {
      sandbox.stub(busService, 'getCalendar').resolves(calendar);
      // First isCalendarOwner call is for revokingAccount (owner), second for editorAccount (not owner)
      const isOwnerStub = sandbox.stub(busService, 'isCalendarOwner');
      isOwnerStub.withArgs(ownerAccount, calendar).resolves(true);
      isOwnerStub.withArgs(editorAccount, calendar).resolves(false);
      sandbox.stub(CalendarMemberEntity, 'destroy').resolves(1);

      // removeEditAccess uses accountsInterface to look up the editor account.
      // Stub it on the service via assignment to the private field.
      (busService as any).accountsInterface = {
        getAccountById: sandbox.stub().resolves(editorAccount),
      };

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await busService.removeEditAccess(ownerAccount, calendar.id, editorAccount.id);

      expect(emitSpy.calledWith(
        CALENDAR_BUS_EVENTS.EDITOR_REVOKED,
        sinon.match({
          calendarId: calendar.id,
          accountId: editorAccount.id,
          revokedBy: ownerAccount.id,
        }),
      )).toBe(true);
    });

    it('should NOT emit calendar:editor:revoked when removeEditAccess deletes zero rows', async () => {
      sandbox.stub(busService, 'getCalendar').resolves(calendar);
      const isOwnerStub = sandbox.stub(busService, 'isCalendarOwner');
      isOwnerStub.withArgs(ownerAccount, calendar).resolves(true);
      isOwnerStub.withArgs(editorAccount, calendar).resolves(false);
      sandbox.stub(CalendarMemberEntity, 'destroy').resolves(0);

      (busService as any).accountsInterface = {
        getAccountById: sandbox.stub().resolves(editorAccount),
      };

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await expect(
        busService.removeEditAccess(ownerAccount, calendar.id, editorAccount.id),
      ).rejects.toThrow();

      expect(emitSpy.calledWith(CALENDAR_BUS_EVENTS.EDITOR_REVOKED)).toBe(false);
    });

    it('should not throw when grantEditorAccess is called without an eventBus', async () => {
      // Use the default service (no eventBus) — emit must be guarded so the
      // production path doesn't depend on a configured bus.
      sandbox.stub(service, 'getCalendar').resolves(calendar);
      sandbox.stub(service, 'isCalendarOwner').resolves(true);
      sandbox.stub(CalendarMemberEntity, 'create').resolves({} as any);

      await expect(
        service.grantEditorAccess(ownerAccount, calendar.id, editorAccount.id),
      ).resolves.toBeUndefined();
    });
  });
});
