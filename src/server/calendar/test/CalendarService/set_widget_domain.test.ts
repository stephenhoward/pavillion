import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { SubscriptionRequiredError } from '@/common/exceptions/subscription';
import { FundingAccessIndeterminateError } from '@/common/exceptions/funding';
import CalendarService from '@/server/calendar/service/calendar';
import FundingInterface from '@/server/funding/interface';

/**
 * setWidgetDomain is the write-side widget_embedding gate. CalendarInterface
 * establishes that the calendar exists and that the caller may modify it
 * before this runs, so these tests cover only the funding question and the
 * three answers it can come back with.
 */
describe('CalendarService.setWidgetDomain', () => {
  let sandbox: sinon.SinonSandbox;
  let service: CalendarService;
  let mockFundingInterface: FundingInterface;
  let checkFundingAccessStub: sinon.SinonStub;
  let account: Account;

  const calendarId = 'calendar-id';
  const domain = 'example.com';

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    checkFundingAccessStub = sandbox.stub();
    mockFundingInterface = {
      checkFundingAccess: checkFundingAccessStub,
    } as any;

    service = new CalendarService(
      undefined,
      undefined,
      undefined,
      mockFundingInterface,
    );

    account = new Account('account-id', 'testuser', 'test@example.com');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should ask the funding domain about widget_embedding for the target calendar', async () => {
    checkFundingAccessStub.resolves(true);

    await service.setWidgetDomain(account, calendarId, domain);

    expect(checkFundingAccessStub.calledOnceWithExactly(calendarId, 'widget_embedding')).toBe(true);
  });

  it('should throw SubscriptionRequiredError naming the feature when the gate is closed', async () => {
    checkFundingAccessStub.resolves(false);

    await expect(
      service.setWidgetDomain(account, calendarId, domain),
    ).rejects.toThrow(SubscriptionRequiredError);

    try {
      await service.setWidgetDomain(account, calendarId, domain);
      expect.fail('Should have thrown SubscriptionRequiredError');
    }
    catch (error) {
      expect((error as SubscriptionRequiredError).feature).toBe('widget_embedding');
      expect((error as Error).message).toBe('widget_embedding requires an active funding plan');
    }
  });

  it('should propagate an indeterminate funding state rather than billing the caller for it', async () => {
    checkFundingAccessStub.rejects(
      new FundingAccessIndeterminateError('Instance funding settings could not be read'),
    );

    // An unreadable instance funding state must reach the route as a server
    // error, never as 402 / SubscriptionRequiredError.
    try {
      await service.setWidgetDomain(account, calendarId, domain);
      expect.fail('Should have thrown FundingAccessIndeterminateError');
    }
    catch (error) {
      expect(error).toBeInstanceOf(FundingAccessIndeterminateError);
      expect(error).not.toBeInstanceOf(SubscriptionRequiredError);
    }
  });

  it('should allow the configuration when no funding domain is wired in', async () => {
    const serviceWithoutFunding = new CalendarService();

    await expect(
      serviceWithoutFunding.setWidgetDomain(account, calendarId, domain),
    ).resolves.toBeUndefined();
  });
});
