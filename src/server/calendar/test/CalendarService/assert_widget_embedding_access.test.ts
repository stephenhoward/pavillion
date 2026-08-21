import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { SubscriptionRequiredError } from '@/common/exceptions/subscription';
import { FundingAccessIndeterminateError } from '@/common/exceptions/funding';
import CalendarService from '@/server/calendar/service/calendar';
import FundingInterface from '@/server/funding/interface';

/**
 * assertWidgetEmbeddingAccess is the calendar domain's only widget_embedding
 * gate, shared by the public widget read and — through CalendarInterface — the
 * widget-domain write. Existence and permission checks belong to those
 * callers, so these tests cover only the funding question and the three
 * answers it can come back with.
 */
describe('CalendarService.assertWidgetEmbeddingAccess', () => {
  let sandbox: sinon.SinonSandbox;
  let service: CalendarService;
  let mockFundingInterface: FundingInterface;
  let checkFundingAccessStub: sinon.SinonStub;

  const calendarId = 'calendar-id';

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
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should ask the funding domain about widget_embedding for the target calendar', async () => {
    checkFundingAccessStub.resolves(true);

    await service.assertWidgetEmbeddingAccess(calendarId);

    expect(checkFundingAccessStub.calledOnceWithExactly(calendarId, 'widget_embedding')).toBe(true);
  });

  it('should throw SubscriptionRequiredError naming the feature when the gate is closed', async () => {
    checkFundingAccessStub.resolves(false);

    await expect(
      service.assertWidgetEmbeddingAccess(calendarId),
    ).rejects.toThrow(SubscriptionRequiredError);

    try {
      await service.assertWidgetEmbeddingAccess(calendarId);
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
      await service.assertWidgetEmbeddingAccess(calendarId);
      expect.fail('Should have thrown FundingAccessIndeterminateError');
    }
    catch (error) {
      expect(error).toBeInstanceOf(FundingAccessIndeterminateError);
      expect(error).not.toBeInstanceOf(SubscriptionRequiredError);
    }
  });

  it('should open the gate when no funding domain is wired in', async () => {
    const serviceWithoutFunding = new CalendarService();

    await expect(
      serviceWithoutFunding.assertWidgetEmbeddingAccess(calendarId),
    ).resolves.toBeUndefined();
  });
});
