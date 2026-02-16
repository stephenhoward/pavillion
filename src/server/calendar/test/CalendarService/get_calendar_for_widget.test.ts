import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { SubscriptionRequiredError } from '@/common/exceptions/subscription';
import CalendarService from '@/server/calendar/service/calendar';
import SubscriptionInterface from '@/server/subscription/interface';

describe('CalendarService.getCalendarForWidget', () => {
  let sandbox: sinon.SinonSandbox;
  let service: CalendarService;
  let mockSubscriptionInterface: SubscriptionInterface;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create mock subscription interface
    mockSubscriptionInterface = {
      getSettings: sandbox.stub(),
      hasActiveSubscription: sandbox.stub(),
    } as any;

    service = new CalendarService(
      undefined,
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
      const hasSubscriptionStub = mockSubscriptionInterface.hasActiveSubscription as sinon.SinonStub;
      expect(hasSubscriptionStub.called).toBe(false);
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

    it('should throw SubscriptionRequiredError if owner lacks active subscription', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      const ownerId = 'owner-account-id';

      sandbox.stub(service, 'getCalendarByName').resolves(calendar);
      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockSubscriptionInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasSubscriptionStub = mockSubscriptionInterface.hasActiveSubscription as sinon.SinonStub;
      hasSubscriptionStub.resolves(false);

      await expect(
        service.getCalendarForWidget('test-calendar'),
      ).rejects.toThrow(SubscriptionRequiredError);

      await expect(
        service.getCalendarForWidget('test-calendar'),
      ).rejects.toThrow('widget_embedding requires an active subscription');

      expect(hasSubscriptionStub.calledWith(ownerId)).toBe(true);
    });

    it('should return calendar if owner has active subscription', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      const ownerId = 'owner-account-id';

      sandbox.stub(service, 'getCalendarByName').resolves(calendar);
      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockSubscriptionInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasSubscriptionStub = mockSubscriptionInterface.hasActiveSubscription as sinon.SinonStub;
      hasSubscriptionStub.resolves(true);

      const result = await service.getCalendarForWidget('test-calendar');

      expect(result).toBe(calendar);
      expect(hasSubscriptionStub.calledWith(ownerId)).toBe(true);
    });

    it('should include feature name in SubscriptionRequiredError', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      const ownerId = 'owner-account-id';

      sandbox.stub(service, 'getCalendarByName').resolves(calendar);
      sandbox.stub(service, 'getCalendarOwnerAccountId').resolves(ownerId);

      const settingsStub = mockSubscriptionInterface.getSettings as sinon.SinonStub;
      settingsStub.resolves({ enabled: true });

      const hasSubscriptionStub = mockSubscriptionInterface.hasActiveSubscription as sinon.SinonStub;
      hasSubscriptionStub.resolves(false);

      try {
        await service.getCalendarForWidget('test-calendar');
        expect.fail('Should have thrown SubscriptionRequiredError');
      }
      catch (error) {
        expect(error).toBeInstanceOf(SubscriptionRequiredError);
        expect((error as SubscriptionRequiredError).feature).toBe('widget_embedding');
      }
    });
  });
});
