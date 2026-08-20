import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { Account } from '@/common/model/account';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { SubscriptionRequiredError } from '@/common/exceptions/subscription';
import CalendarService from '@/server/calendar/service/calendar';
import FundingInterface from '@/server/funding/interface';
import AccountsInterface from '@/server/accounts/interface';

describe('CalendarService.getCalendarForWidget', () => {
  let sandbox: sinon.SinonSandbox;
  let service: CalendarService;
  let mockFundingInterface: FundingInterface;
  let mockAccountsInterface: AccountsInterface;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create mock accounts interface
    mockAccountsInterface = {
      getAccountById: sandbox.stub(),
      loadAccountRoles: sandbox.stub(),
    } as any;

    // Create mock funding interface
    mockFundingInterface = {
      getSettings: sandbox.stub(),
      hasFundingAccess: sandbox.stub(),
    } as any;

    service = new CalendarService(
      mockAccountsInterface,
      undefined,
      undefined,
      mockFundingInterface,
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('when calendar does not exist', () => {
    it('should throw CalendarNotFoundError', async () => {
      sandbox.stub(service, 'getCalendarByName').resolves(null);

      await expect(
        service.getCalendarForWidget('nonexistent'),
      ).rejects.toThrow(CalendarNotFoundError);
    });
  });

  describe('when funding is disabled (free instance)', () => {
    it('should return calendar without a funding-access check', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      sandbox.stub(service, 'getCalendarByName').resolves(calendar);

      const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: false });

      const result = await service.getCalendarForWidget('test-calendar');

      expect(result).toBe(calendar);
      expect(settingsStub.calledOnce).toBe(true);
      // Should not check funding access when disabled
      const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
      expect(hasFundingAccessStub.called).toBe(false);
    });
  });

  describe('when funding is enabled', () => {
    it('should throw SubscriptionRequiredError if calendar has no owner', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      sandbox.stub(service, 'getCalendarByName').resolves(calendar);
      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(null);

      const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      await expect(
        service.getCalendarForWidget('test-calendar'),
      ).rejects.toThrow(CalendarNotFoundError);
    });

    it('should throw SubscriptionRequiredError if owner lacks a funding plan access', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      const ownerId = 'owner-account-id';

      sandbox.stub(service, 'getCalendarByName').resolves(calendar);
      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
      hasFundingAccessStub.resolves(false);

      await expect(
        service.getCalendarForWidget('test-calendar'),
      ).rejects.toThrow(SubscriptionRequiredError);

      await expect(
        service.getCalendarForWidget('test-calendar'),
      ).rejects.toThrow('widget_embedding requires an active funding plan');

      expect(hasFundingAccessStub.calledWith(calendar.id)).toBe(true);
    });

    it('should return calendar if owner has active funding plan', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      const ownerId = 'owner-account-id';

      sandbox.stub(service, 'getCalendarByName').resolves(calendar);
      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
      hasFundingAccessStub.resolves(true);

      const result = await service.getCalendarForWidget('test-calendar');

      expect(result).toBe(calendar);
      expect(hasFundingAccessStub.calledWith(calendar.id)).toBe(true);
    });

    it('should return calendar if owner has active complimentary grant', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      const ownerId = 'owner-account-id';

      sandbox.stub(service, 'getCalendarByName').resolves(calendar);
      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
      // hasFundingAccess returns true when account has a grant (even without active funding plan)
      hasFundingAccessStub.resolves(true);

      const result = await service.getCalendarForWidget('test-calendar');

      expect(result).toBe(calendar);
      expect(hasFundingAccessStub.calledWith(calendar.id)).toBe(true);
    });

    it('should include feature name in SubscriptionRequiredError', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      const ownerId = 'owner-account-id';

      sandbox.stub(service, 'getCalendarByName').resolves(calendar);
      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
      hasFundingAccessStub.resolves(false);

      try {
        await service.getCalendarForWidget('test-calendar');
        expect.fail('Should have thrown SubscriptionRequiredError');
      }
      catch (error) {
        expect(error).toBeInstanceOf(SubscriptionRequiredError);
        expect((error as SubscriptionRequiredError).feature).toBe('widget_embedding');
      }
    });

    describe('admin bypass', () => {
      it('should bypass funding-access check if calendar owner is admin', async () => {
        const calendar = new Calendar('calendar-id', 'test-calendar');
        const ownerId = 'admin-account-id';
        const adminAccount = new Account('admin-account-id', 'admin', 'admin@example.com');
        adminAccount.roles = ['admin'];

        sandbox.stub(service, 'getCalendarByName').resolves(calendar);
        sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

        const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
        settingsStub.resolves({ enabled: true });

        const getAccountStub = mockAccountsInterface.getAccountById as sinon.SinonStub;
        getAccountStub.withArgs(ownerId).resolves(adminAccount);

        const loadRolesStub = mockAccountsInterface.loadAccountRoles as sinon.SinonStub;
        loadRolesStub.withArgs(adminAccount).resolves(adminAccount);

        const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;

        const result = await service.getCalendarForWidget('test-calendar');

        expect(result).toBe(calendar);
        // Should not check funding access for admin
        expect(hasFundingAccessStub.called).toBe(false);
      });

      it('should require a funding plan if calendar owner is not admin', async () => {
        const calendar = new Calendar('calendar-id', 'test-calendar');
        const ownerId = 'regular-account-id';
        const regularAccount = new Account('regular-account-id', 'user', 'user@example.com');
        regularAccount.roles = ['user'];

        sandbox.stub(service, 'getCalendarByName').resolves(calendar);
        sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

        const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
        settingsStub.resolves({ enabled: true });

        const getAccountStub = mockAccountsInterface.getAccountById as sinon.SinonStub;
        getAccountStub.withArgs(ownerId).resolves(regularAccount);

        const loadRolesStub = mockAccountsInterface.loadAccountRoles as sinon.SinonStub;
        loadRolesStub.withArgs(regularAccount).resolves(regularAccount);

        const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
        hasFundingAccessStub.resolves(false);

        await expect(
          service.getCalendarForWidget('test-calendar'),
        ).rejects.toThrow(SubscriptionRequiredError);

        // Should check funding access for non-admin
        expect(hasFundingAccessStub.calledWith(calendar.id)).toBe(true);
      });

      it('should require a funding plan if account not found (fail-secure)', async () => {
        const calendar = new Calendar('calendar-id', 'test-calendar');
        const ownerId = 'unknown-account-id';

        sandbox.stub(service, 'getCalendarByName').resolves(calendar);
        sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

        const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
        settingsStub.resolves({ enabled: true });

        const getAccountStub = mockAccountsInterface.getAccountById as sinon.SinonStub;
        getAccountStub.withArgs(ownerId).resolves(undefined);

        const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
        hasFundingAccessStub.resolves(false);

        await expect(
          service.getCalendarForWidget('test-calendar'),
        ).rejects.toThrow(SubscriptionRequiredError);

        // Should check funding access when account lookup fails
        expect(hasFundingAccessStub.calledWith(calendar.id)).toBe(true);
      });

      it('should require a funding plan if roles cannot be loaded (fail-secure)', async () => {
        const calendar = new Calendar('calendar-id', 'test-calendar');
        const ownerId = 'account-id';
        const account = new Account('account-id', 'user', 'user@example.com');
        // No roles loaded

        sandbox.stub(service, 'getCalendarByName').resolves(calendar);
        sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

        const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
        settingsStub.resolves({ enabled: true });

        const getAccountStub = mockAccountsInterface.getAccountById as sinon.SinonStub;
        getAccountStub.withArgs(ownerId).resolves(account);

        const loadRolesStub = mockAccountsInterface.loadAccountRoles as sinon.SinonStub;
        // Return account with no roles (null/undefined)
        loadRolesStub.withArgs(account).resolves(account);

        const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
        hasFundingAccessStub.resolves(false);

        await expect(
          service.getCalendarForWidget('test-calendar'),
        ).rejects.toThrow(SubscriptionRequiredError);

        // Should check funding access when roles can't be determined
        expect(hasFundingAccessStub.calledWith(calendar.id)).toBe(true);
      });
    });
  });
});
