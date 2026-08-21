import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { SubscriptionRequiredError } from '@/common/exceptions/subscription';
import { FundingAccessIndeterminateError } from '@/common/exceptions/funding';
import CalendarService from '@/server/calendar/service/calendar';
import FundingInterface from '@/server/funding/interface';

/**
 * The calendar domain holds no funding state and applies no funding policy of
 * its own: it asks FundingInterface about the 'widget_embedding' registry key
 * and acts on the answer. These tests cover that call site — how the three
 * outcomes of checkFundingAccess reach a widget caller — not the policy behind
 * the answer, which belongs to the funding domain's own tests.
 */
describe('CalendarService.getCalendarForWidget', () => {
  let sandbox: sinon.SinonSandbox;
  let service: CalendarService;
  let mockFundingInterface: FundingInterface;
  let checkFundingAccessStub: sinon.SinonStub;

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

  it('should throw CalendarNotFoundError without consulting the gate when the calendar does not exist', async () => {
    sandbox.stub(service, 'getCalendarByName').resolves(null);

    await expect(
      service.getCalendarForWidget('nonexistent'),
    ).rejects.toThrow(CalendarNotFoundError);

    expect(checkFundingAccessStub.called).toBe(false);
  });

  it('should ask the funding domain about widget_embedding for the resolved calendar', async () => {
    const calendar = new Calendar('calendar-id', 'test-calendar');
    sandbox.stub(service, 'getCalendarByName').resolves(calendar);
    checkFundingAccessStub.resolves(true);

    const result = await service.getCalendarForWidget('test-calendar');

    expect(result).toBe(calendar);
    expect(checkFundingAccessStub.calledOnceWithExactly(calendar.id, 'widget_embedding')).toBe(true);
  });

  it('should throw SubscriptionRequiredError naming the feature when the gate is closed', async () => {
    const calendar = new Calendar('calendar-id', 'test-calendar');
    sandbox.stub(service, 'getCalendarByName').resolves(calendar);
    checkFundingAccessStub.resolves(false);

    await expect(
      service.getCalendarForWidget('test-calendar'),
    ).rejects.toThrow(SubscriptionRequiredError);

    try {
      await service.getCalendarForWidget('test-calendar');
      expect.fail('Should have thrown SubscriptionRequiredError');
    }
    catch (error) {
      expect((error as SubscriptionRequiredError).feature).toBe('widget_embedding');
      expect((error as Error).message).toBe('widget_embedding requires an active funding plan');
    }
  });

  it('should propagate an indeterminate funding state rather than billing the caller for it', async () => {
    const calendar = new Calendar('calendar-id', 'test-calendar');
    sandbox.stub(service, 'getCalendarByName').resolves(calendar);
    checkFundingAccessStub.rejects(
      new FundingAccessIndeterminateError('Instance funding settings could not be read'),
    );

    // An unreadable instance funding state is our outage, not an unpaid bill:
    // it must not be laundered into a 402-bearing SubscriptionRequiredError.
    try {
      await service.getCalendarForWidget('test-calendar');
      expect.fail('Should have thrown FundingAccessIndeterminateError');
    }
    catch (error) {
      expect(error).toBeInstanceOf(FundingAccessIndeterminateError);
      expect(error).not.toBeInstanceOf(SubscriptionRequiredError);
    }
  });

  it('should serve the widget when no funding domain is wired in', async () => {
    const serviceWithoutFunding = new CalendarService();
    const calendar = new Calendar('calendar-id', 'test-calendar');
    sandbox.stub(serviceWithoutFunding, 'getCalendarByName').resolves(calendar);

    const result = await serviceWithoutFunding.getCalendarForWidget('test-calendar');

    expect(result).toBe(calendar);
  });
});
