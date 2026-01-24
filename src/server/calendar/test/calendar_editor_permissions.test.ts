import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarService from '@/server/calendar/service/calendar';
import { CalendarEditorPersonEntity } from '@/server/calendar/entity/calendar_editor_person';
import { CalendarEditorEntity } from '@/server/calendar/entity/calendar_editor';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { AccountEntity } from '@/server/common/entity/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';

describe('CalendarService - Editor Permissions', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let service: CalendarService;
  let ownerAccount: Account;
  let editorAccount: Account;
  let calendar: Calendar;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    service = new CalendarService(eventBus, configInterface, setupInterface);

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
    it('should create calendar_editor_person record', async () => {
      // Stub getCalendar to return test calendar
      sandbox.stub(service, 'getCalendar').resolves(calendar);

      // Stub isCalendarOwner to return true for owner
      sandbox.stub(service, 'isCalendarOwner').resolves(true);

      // Stub CalendarEditorPersonEntity.create
      const createStub = sandbox.stub(CalendarEditorPersonEntity, 'create').resolves({
        id: 'editor-record-id',
        calendar_id: calendar.id,
        account_id: editorAccount.id,
        granted_by: ownerAccount.id,
      } as any);

      await service.grantEditorAccess(ownerAccount, calendar.id, editorAccount.id);

      expect(createStub.calledOnce).toBe(true);
      expect(createStub.firstCall.args[0]).toMatchObject({
        calendar_id: calendar.id,
        account_id: editorAccount.id,
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
    it('should remove editor relationship', async () => {
      sandbox.stub(service, 'getCalendar').resolves(calendar);

      // Stub isCalendarOwner to return true for owner
      sandbox.stub(service, 'isCalendarOwner').resolves(true);

      const mockEditorEntity = {
        calendar_id: calendar.id,
        account_id: editorAccount.id,
        destroy: sandbox.stub().resolves(),
      };

      const findOneStub = sandbox.stub(CalendarEditorPersonEntity, 'findOne').resolves(mockEditorEntity as any);

      await service.revokeEditorAccess(ownerAccount, calendar.id, editorAccount.id);

      expect(findOneStub.calledOnce).toBe(true);
      expect(mockEditorEntity.destroy.calledOnce).toBe(true);
    });

    it('should throw error if non-owner tries to revoke access', async () => {
      sandbox.stub(service, 'getCalendar').resolves(calendar);

      await expect(
        service.revokeEditorAccess(editorAccount, calendar.id, 'some-user-id'),
      ).rejects.toThrow();
    });

    it('should throw error if editor relationship not found', async () => {
      sandbox.stub(service, 'getCalendar').resolves(calendar);
      sandbox.stub(CalendarEditorPersonEntity, 'findOne').resolves(null);

      await expect(
        service.revokeEditorAccess(ownerAccount, calendar.id, editorAccount.id),
      ).rejects.toThrow();
    });
  });

  describe('userCanEditCalendar', () => {
    it('should return true for calendar owner', async () => {
      sandbox.stub(service, 'getCalendar').resolves(calendar);
      sandbox.stub(CalendarEditorEntity, 'findOne').resolves(null);
      sandbox.stub(CalendarEditorPersonEntity, 'findOne').resolves(null);

      const result = await service.userCanEditCalendar(ownerAccount.id, calendar.id);

      expect(result).toBe(true);
    });

    it('should return true for editors', async () => {
      sandbox.stub(service, 'getCalendar').resolves(calendar);

      const mockEditorEntity = {
        calendar_id: calendar.id,
        account_id: editorAccount.id,
      };

      sandbox.stub(CalendarEditorEntity, 'findOne').resolves(null);
      sandbox.stub(CalendarEditorPersonEntity, 'findOne').resolves(mockEditorEntity as any);

      const result = await service.userCanEditCalendar(editorAccount.id, calendar.id);

      expect(result).toBe(true);
    });

    it('should return false for non-editors', async () => {
      const randomAccount = new Account('random-id');

      sandbox.stub(service, 'getCalendar').resolves(calendar);
      sandbox.stub(CalendarEditorEntity, 'findOne').resolves(null);
      sandbox.stub(CalendarEditorPersonEntity, 'findOne').resolves(null);

      const result = await service.userCanEditCalendar(randomAccount.id, calendar.id);

      expect(result).toBe(false);
    });

    it('should return false if calendar not found', async () => {
      sandbox.stub(service, 'getCalendar').resolves(null);

      const result = await service.userCanEditCalendar(ownerAccount.id, 'nonexistent-calendar');

      expect(result).toBe(false);
    });
  });

  describe('listPersonEditors', () => {
    it('should return all editors with metadata', async () => {
      sandbox.stub(service, 'getCalendar').resolves(calendar);

      const mockEditorEntities = [
        {
          id: 'editor-record-1',
          calendar_id: calendar.id,
          account_id: 'editor-1-id',
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
          id: 'editor-record-2',
          calendar_id: calendar.id,
          account_id: 'editor-2-id',
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

      sandbox.stub(CalendarEditorPersonEntity, 'findAll').resolves(mockEditorEntities as any);

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
      sandbox.stub(CalendarEditorPersonEntity, 'findAll').resolves([]);

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
});
