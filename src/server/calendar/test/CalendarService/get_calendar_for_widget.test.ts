import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { Account } from '@/common/model/account';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { SubscriptionRequiredError } from '@/common/exceptions/subscription';
import CalendarService from '@/server/calendar/service/calendar';
import SubscriptionInterface from '@/server/subscription/interface';
import AccountsInterface from '@/server/accounts/interface';

describe('CalendarService.getCalendarForWidget', () => {
  let sandbox: sinon.SinonSandbox;
  let service: CalendarService;
  let mockSubscriptionInterface: SubscriptionInterface;
  let mockAccountsInterface: AccountsInterface;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create mock accounts interface
    mockAccountsInterface = {
      getAccountById: sandbox.stub(),
      loadAccountRoles: sandbox.stub(),
    } as any;

    // Create mock subscription interface
    mockSubscriptionInterface = {
      getSettings: sandbox.stub(),
      hasSubscriptionAccess: sandbox.stub(),
    } as any;

    service = new CalendarService(
      mockAccountsInterface,
      undefined,
      undefined,
      mockSubscriptionInterface,
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

  describe('when subscriptions are disabled (free instance)', () => {
    it('should return calendar without subscription check', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      sandbox.stub(service, 'getCalendarByName').resolves(calendar);

      const settingsStub = mockSubscriptionInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: false });

      const result = await service.getCalendarForWidget('test-calendar');

      expect(result).toBe(calendar);
      expect(settingsStub.calledOnce).toBe(true);
      // Should not check subscription when disabled
      const hasSubscriptionAccessStub = mockSubscriptionInterface.hasSubscriptionAccess as sinon.SinonStub;
      expect(hasSubscriptionAccessStub.called).toBe(false);
    });
  });

  describe('when subscriptions are enabled', () => {
    it('should throw SubscriptionRequiredError if calendar has no owner', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      sandbox.stub(service, 'getCalendarByName').resolves(calendar);
      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(null);

      const settingsStub = mockSubscriptionInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      await expect(
        service.getCalendarForWidget('test-calendar'),
      ).rejects.toThrow(CalendarNotFoundError);
    });

    it('should throw SubscriptionRequiredError if owner lacks subscription access', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      const ownerId = 'owner-account-id';

      sandbox.stub(service, 'getCalendarByName').resolves(calendar);
      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockSubscriptionInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasSubscriptionAccessStub = mockSubscriptionInterface.hasSubscriptionAccess as sinon.SinonStub;
      hasSubscriptionAccessStub.resolves(false);

      await expect(
        service.getCalendarForWidget('test-calendar'),
      ).rejects.toThrow(SubscriptionRequiredError);

      await expect(
        service.getCalendarForWidget('test-calendar'),
      ).rejects.toThrow('widget_embedding requires an active subscription');

      expect(hasSubscriptionAccessStub.calledWith(ownerId)).toBe(true);
    });

    it('should return calendar if owner has active subscription', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      const ownerId = 'owner-account-id';

      sandbox.stub(service, 'getCalendarByName').resolves(calendar);
      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockSubscriptionInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasSubscriptionAccessStub = mockSubscriptionInterface.hasSubscriptionAccess as sinon.SinonStub;
      hasSubscriptionAccessStub.resolves(true);

      const result = await service.getCalendarForWidget('test-calendar');

      expect(result).toBe(calendar);
      expect(hasSubscriptionAccessStub.calledWith(ownerId)).toBe(true);
    });

    it('should return calendar if owner has active complimentary grant', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      const ownerId = 'owner-account-id';

      sandbox.stub(service, 'getCalendarByName').resolves(calendar);
      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockSubscriptionInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasSubscriptionAccessStub = mockSubscriptionInterface.hasSubscriptionAccess as sinon.SinonStub;
      // hasSubscriptionAccess returns true when account has a grant (even without active subscription)
      hasSubscriptionAccessStub.resolves(true);

      const result = await service.getCalendarForWidget('test-calendar');

      expect(result).toBe(calendar);
      expect(hasSubscriptionAccessStub.calledWith(ownerId)).toBe(true);
    });

    it('should include feature name in SubscriptionRequiredError', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      const ownerId = 'owner-account-id';

      sandbox.stub(service, 'getCalendarByName').resolves(calendar);
      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockSubscriptionInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasSubscriptionAccessStub = mockSubscriptionInterface.hasSubscriptionAccess as sinon.SinonStub;
      hasSubscriptionAccessStub.resolves(false);

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
      it('should bypass subscription check if calendar owner is admin', async () => {
        const calendar = new Calendar('calendar-id', 'test-calendar');
        const ownerId = 'admin-account-id';
        const adminAccount = new Account('admin-account-id', 'admin', 'admin@example.com');
        adminAccount.roles = ['admin'];

        sandbox.stub(service, 'getCalendarByName').resolves(calendar);
        sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

        const settingsStub = mockSubscriptionInterface.getSettings as sinon.SinonStub;
        settingsStub.resolves({ enabled: true });

        const getAccountStub = mockAccountsInterface.getAccountById as sinon.SinonStub;
        getAccountStub.withArgs(ownerId).resolves(adminAccount);

        const loadRolesStub = mockAccountsInterface.loadAccountRoles as sinon.SinonStub;
        loadRolesStub.withArgs(adminAccount).resolves(adminAccount);

        const hasSubscriptionAccessStub = mockSubscriptionInterface.hasSubscriptionAccess as sinon.SinonStub;

        const result = await service.getCalendarForWidget('test-calendar');

        expect(result).toBe(calendar);
        // Should not check subscription for admin
        expect(hasSubscriptionAccessStub.called).toBe(false);
      });

      it('should require subscription if calendar owner is not admin', async () => {
        const calendar = new Calendar('calendar-id', 'test-calendar');
        const ownerId = 'regular-account-id';
        const regularAccount = new Account('regular-account-id', 'user', 'user@example.com');
        regularAccount.roles = ['user'];

        sandbox.stub(service, 'getCalendarByName').resolves(calendar);
        sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

        const settingsStub = mockSubscriptionInterface.getSettings as sinon.SinonStub;
        settingsStub.resolves({ enabled: true });

        const getAccountStub = mockAccountsInterface.getAccountById as sinon.SinonStub;
        getAccountStub.withArgs(ownerId).resolves(regularAccount);

        const loadRolesStub = mockAccountsInterface.loadAccountRoles as sinon.SinonStub;
        loadRolesStub.withArgs(regularAccount).resolves(regularAccount);

        const hasSubscriptionAccessStub = mockSubscriptionInterface.hasSubscriptionAccess as sinon.SinonStub;
        hasSubscriptionAccessStub.resolves(false);

        await expect(
          service.getCalendarForWidget('test-calendar'),
        ).rejects.toThrow(SubscriptionRequiredError);

        // Should check subscription for non-admin
        expect(hasSubscriptionAccessStub.calledWith(ownerId)).toBe(true);
      });

      it('should require subscription if account not found (fail-secure)', async () => {
        const calendar = new Calendar('calendar-id', 'test-calendar');
        const ownerId = 'unknown-account-id';

        sandbox.stub(service, 'getCalendarByName').resolves(calendar);
        sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

        const settingsStub = mockSubscriptionInterface.getSettings as sinon.SinonStub;
        settingsStub.resolves({ enabled: true });

        const getAccountStub = mockAccountsInterface.getAccountById as sinon.SinonStub;
        getAccountStub.withArgs(ownerId).resolves(undefined);

        const hasSubscriptionAccessStub = mockSubscriptionInterface.hasSubscriptionAccess as sinon.SinonStub;
        hasSubscriptionAccessStub.resolves(false);

        await expect(
          service.getCalendarForWidget('test-calendar'),
        ).rejects.toThrow(SubscriptionRequiredError);

        // Should check subscription when account lookup fails
        expect(hasSubscriptionAccessStub.calledWith(ownerId)).toBe(true);
      });

      it('should require subscription if roles cannot be loaded (fail-secure)', async () => {
        const calendar = new Calendar('calendar-id', 'test-calendar');
        const ownerId = 'account-id';
        const account = new Account('account-id', 'user', 'user@example.com');
        // No roles loaded

        sandbox.stub(service, 'getCalendarByName').resolves(calendar);
        sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

        const settingsStub = mockSubscriptionInterface.getSettings as sinon.SinonStub;
        settingsStub.resolves({ enabled: true });

        const getAccountStub = mockAccountsInterface.getAccountById as sinon.SinonStub;
        getAccountStub.withArgs(ownerId).resolves(account);

        const loadRolesStub = mockAccountsInterface.loadAccountRoles as sinon.SinonStub;
        // Return account with no roles (null/undefined)
        loadRolesStub.withArgs(account).resolves(account);

        const hasSubscriptionAccessStub = mockSubscriptionInterface.hasSubscriptionAccess as sinon.SinonStub;
        hasSubscriptionAccessStub.resolves(false);

        await expect(
          service.getCalendarForWidget('test-calendar'),
        ).rejects.toThrow(SubscriptionRequiredError);

        // Should check subscription when roles can't be determined
        expect(hasSubscriptionAccessStub.calledWith(ownerId)).toBe(true);
      });
    });
  });
});
