import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { SubscriptionRequiredError } from '@/common/exceptions/subscription';
import CalendarService from '@/server/calendar/service/calendar';
import FundingInterface from '@/server/funding/interface';
import AccountsInterface from '@/server/accounts/interface';

describe('CalendarService.setWidgetDomain', () => {
  let sandbox: sinon.SinonSandbox;
  let service: CalendarService;
  let mockFundingInterface: FundingInterface;
  let mockAccountsInterface: AccountsInterface;
  let account: Account;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create mock accounts interface
    mockAccountsInterface = {
      getAccountById: sandbox.stub(),
      loadAccountRoles: sandbox.stub(),
    } as any;

    // Create mock subscription interface
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

    account = new Account('account-id', 'testuser', 'test@example.com');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('when subscriptions are disabled (free instance)', () => {
    it('should succeed without subscription check', async () => {
      const calendarId = 'calendar-id';
      const domain = 'example.com';

      const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: false });

      await service.setWidgetDomain(account, calendarId, domain);

      // Should not check subscription when disabled
      const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
      expect(hasFundingAccessStub.called).toBe(false);
    });
  });

  describe('when subscriptions are enabled', () => {
    it('should throw CalendarNotFoundError if calendar has no owner', async () => {
      const calendarId = 'calendar-id';
      const domain = 'example.com';

      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(null);

      const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      await expect(
        service.setWidgetDomain(account, calendarId, domain),
      ).rejects.toThrow(CalendarNotFoundError);
    });

    it('should throw SubscriptionRequiredError if owner lacks subscription access', async () => {
      const calendarId = 'calendar-id';
      const ownerId = 'owner-account-id';
      const domain = 'example.com';

      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
      hasFundingAccessStub.resolves(false);

      await expect(
        service.setWidgetDomain(account, calendarId, domain),
      ).rejects.toThrow(SubscriptionRequiredError);

      await expect(
        service.setWidgetDomain(account, calendarId, domain),
      ).rejects.toThrow('widget_embedding requires an active subscription');

      expect(hasFundingAccessStub.calledWith(calendarId)).toBe(true);
    });

    it('should succeed if owner has active subscription', async () => {
      const calendarId = 'calendar-id';
      const ownerId = 'owner-account-id';
      const domain = 'example.com';

      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
      hasFundingAccessStub.resolves(true);

      await service.setWidgetDomain(account, calendarId, domain);

      expect(hasFundingAccessStub.calledWith(calendarId)).toBe(true);
    });

    it('should succeed if owner has active complimentary grant', async () => {
      const calendarId = 'calendar-id';
      const ownerId = 'owner-account-id';
      const domain = 'example.com';

      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
      // hasFundingAccess returns true when calendar has a grant (even without active subscription)
      hasFundingAccessStub.resolves(true);

      await service.setWidgetDomain(account, calendarId, domain);

      expect(hasFundingAccessStub.calledWith(calendarId)).toBe(true);
    });

    it('should include feature name in SubscriptionRequiredError', async () => {
      const calendarId = 'calendar-id';
      const ownerId = 'owner-account-id';
      const domain = 'example.com';

      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
      hasFundingAccessStub.resolves(false);

      try {
        await service.setWidgetDomain(account, calendarId, domain);
        expect.fail('Should have thrown SubscriptionRequiredError');
      }
      catch (error) {
        expect(error).toBeInstanceOf(SubscriptionRequiredError);
        expect((error as SubscriptionRequiredError).feature).toBe('widget_embedding');
      }
    });

    describe('admin bypass', () => {
      it('should bypass subscription check if calendar owner is admin', async () => {
        const calendarId = 'calendar-id';
        const ownerId = 'admin-account-id';
        const domain = 'example.com';
        const adminAccount = new Account('admin-account-id', 'admin', 'admin@example.com');
        adminAccount.roles = ['admin'];

        sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

        const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
        settingsStub.resolves({ enabled: true });

        const getAccountStub = mockAccountsInterface.getAccountById as sinon.SinonStub;
        getAccountStub.withArgs(ownerId).resolves(adminAccount);

        const loadRolesStub = mockAccountsInterface.loadAccountRoles as sinon.SinonStub;
        loadRolesStub.withArgs(adminAccount).resolves(adminAccount);

        const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;

        await service.setWidgetDomain(account, calendarId, domain);

        // Should not check subscription for admin
        expect(hasFundingAccessStub.called).toBe(false);
      });

      it('should require subscription if calendar owner is not admin', async () => {
        const calendarId = 'calendar-id';
        const ownerId = 'regular-account-id';
        const domain = 'example.com';
        const regularAccount = new Account('regular-account-id', 'user', 'user@example.com');
        regularAccount.roles = ['user'];

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
          service.setWidgetDomain(account, calendarId, domain),
        ).rejects.toThrow(SubscriptionRequiredError);

        // Should check subscription for non-admin using calendarId (not account ID)
        expect(hasFundingAccessStub.calledWith(calendarId)).toBe(true);
      });

      it('should require subscription if account not found (fail-secure)', async () => {
        const calendarId = 'calendar-id';
        const ownerId = 'unknown-account-id';
        const domain = 'example.com';

        sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

        const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
        settingsStub.resolves({ enabled: true });

        const getAccountStub = mockAccountsInterface.getAccountById as sinon.SinonStub;
        getAccountStub.withArgs(ownerId).resolves(undefined);

        const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
        hasFundingAccessStub.resolves(false);

        await expect(
          service.setWidgetDomain(account, calendarId, domain),
        ).rejects.toThrow(SubscriptionRequiredError);

        // Should check subscription using calendarId (not account ID) when account lookup fails
        expect(hasFundingAccessStub.calledWith(calendarId)).toBe(true);
      });

      it('should require subscription if roles cannot be loaded (fail-secure)', async () => {
        const calendarId = 'calendar-id';
        const ownerId = 'account-id';
        const domain = 'example.com';
        const ownerAccount = new Account('account-id', 'user', 'user@example.com');
        // No roles loaded

        sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

        const settingsStub = mockFundingInterface.getSettings as sinon.SinonStub;
        settingsStub.resolves({ enabled: true });

        const getAccountStub = mockAccountsInterface.getAccountById as sinon.SinonStub;
        getAccountStub.withArgs(ownerId).resolves(ownerAccount);

        const loadRolesStub = mockAccountsInterface.loadAccountRoles as sinon.SinonStub;
        // Return account with no roles (null/undefined)
        loadRolesStub.withArgs(ownerAccount).resolves(ownerAccount);

        const hasFundingAccessStub = mockFundingInterface.hasFundingAccess as sinon.SinonStub;
        hasFundingAccessStub.resolves(false);

        await expect(
          service.setWidgetDomain(account, calendarId, domain),
        ).rejects.toThrow(SubscriptionRequiredError);

        // Should check subscription using calendarId (not account ID) when roles can't be determined
        expect(hasFundingAccessStub.calledWith(calendarId)).toBe(true);
      });
    });
  });
});
