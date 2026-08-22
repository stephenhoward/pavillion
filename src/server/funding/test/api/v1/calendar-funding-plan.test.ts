import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
import CalendarFundingPlanRoutes from '@/server/funding/api/v1/calendar-funding-plan';
import FundingInterface from '@/server/funding/interface';
import { Account } from '@/common/model/account';
import { testApp } from '@/server/common/test/lib/express';
import {
  FundingPlanNotFoundError,
  CalendarFundingPlanNotFoundError,
  DuplicateCalendarFundingPlanError,
  FundingAccessIndeterminateError,
} from '@/common/exceptions/funding';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { ValidationError } from '@/common/exceptions/base';

/**
 * Tests for CalendarFundingPlanRoutes API handlers.
 *
 * These tests verify the HTTP-level behavior of POST /calendars,
 * GET /calendars, DELETE /calendars/:calendarId, and
 * GET /calendars/:calendarId/funding without rate limiting middleware
 * (bypassed via direct handler binding).
 */
describe('CalendarFundingPlanRoutes API', () => {
  let sandbox: sinon.SinonSandbox;
  let router: express.Router;
  let mockInterface: sinon.SinonStubbedInstance<FundingInterface>;
  let routes: CalendarFundingPlanRoutes;
  let mockAccount: Account;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    router = express.Router();

    // Create a stub of FundingInterface
    mockInterface = sandbox.createStubInstance(FundingInterface);
    routes = new CalendarFundingPlanRoutes(mockInterface as any);

    mockAccount = new Account('test-account-id');
    mockAccount.email = 'test@example.com';
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('POST /calendars (addCalendar)', () => {
    const bindAddCalendar = () => {
      router.post('/handler', (req: Request, _res: Response, next) => {
        req.user = mockAccount;
        next();
      }, routes['addCalendar'].bind(routes));
    };

    it('should return 200 on successful add', async () => {
      mockInterface.addCalendarToFundingPlan.resolves();

      bindAddCalendar();

      const response = await request(testApp(router))
        .post('/handler')
        .send({
          calendarId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
          amount: 500000,
        })
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(mockInterface.addCalendarToFundingPlan.calledOnce).toBe(true);
      expect(mockInterface.addCalendarToFundingPlan.calledWith(
        'test-account-id',
        'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        500000,
      )).toBe(true);
    });

    it('should return 401 when not authenticated', async () => {
      router.post('/handler', routes['addCalendar'].bind(routes));

      await request(testApp(router))
        .post('/handler')
        .send({ calendarId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', amount: 500000 })
        .expect(401);
    });

    it('should return 400 when calendarId is missing', async () => {
      bindAddCalendar();

      const response = await request(testApp(router))
        .post('/handler')
        .send({ amount: 500000 })
        .expect(400);

      expect(response.body.error).toContain('calendarId is required');
    });

    it('should return 400 when calendarId is not a valid UUID', async () => {
      bindAddCalendar();

      const response = await request(testApp(router))
        .post('/handler')
        .send({ calendarId: 'not-a-uuid', amount: 500000 })
        .expect(400);

      expect(response.body.error).toContain('Invalid calendarId');
    });

    it('should return 400 when amount is missing', async () => {
      bindAddCalendar();

      const response = await request(testApp(router))
        .post('/handler')
        .send({ calendarId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' })
        .expect(400);

      expect(response.body.error).toContain('amount is required');
    });

    it('should return 404 when service throws FundingPlanNotFoundError', async () => {
      mockInterface.addCalendarToFundingPlan.rejects(
        new FundingPlanNotFoundError('test-account-id'),
      );

      bindAddCalendar();

      const response = await request(testApp(router))
        .post('/handler')
        .send({ calendarId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', amount: 500000 })
        .expect(404);

      expect(response.body.errorName).toBe('FundingPlanNotFoundError');
    });

    it('should return 409 when calendar already has an active funding plan', async () => {
      mockInterface.addCalendarToFundingPlan.rejects(
        new DuplicateCalendarFundingPlanError('sub-1', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'),
      );

      bindAddCalendar();

      const response = await request(testApp(router))
        .post('/handler')
        .send({ calendarId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', amount: 500000 })
        .expect(409);

      expect(response.body.errorName).toBe('DuplicateCalendarFundingPlanError');
    });

    it('should return 404 when calendar does not exist', async () => {
      mockInterface.addCalendarToFundingPlan.rejects(
        new CalendarNotFoundError('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'),
      );

      bindAddCalendar();

      const response = await request(testApp(router))
        .post('/handler')
        .send({ calendarId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', amount: 500000 })
        .expect(404);

      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return 400 when service throws ValidationError (ownership)', async () => {
      mockInterface.addCalendarToFundingPlan.rejects(
        new ValidationError('Account does not own this calendar'),
      );

      bindAddCalendar();

      const response = await request(testApp(router))
        .post('/handler')
        .send({ calendarId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', amount: 500000 })
        .expect(400);

      expect(response.body.errorName).toBe('ValidationError');
    });
  });

  describe('GET /calendars (getCalendars)', () => {
    const bindGetCalendars = () => {
      router.get('/handler', (req: Request, _res: Response, next) => {
        req.user = mockAccount;
        next();
      }, routes['getCalendars'].bind(routes));
    };

    it('should return 200 with array of covered calendars', async () => {
      mockInterface.getCalendarsInFundingPlan.resolves([
        { calendarId: 'cal-1-uuid-aaaa-bbbb-ccccddddeeee', amount: 500000, createdAt: new Date('2026-01-01') },
        { calendarId: 'cal-2-uuid-aaaa-bbbb-ccccddddeeee', amount: 300000, createdAt: new Date('2026-02-01') },
      ]);

      bindGetCalendars();

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body).toEqual([
        { calendarId: 'cal-1-uuid-aaaa-bbbb-ccccddddeeee', amount: 500000 },
        { calendarId: 'cal-2-uuid-aaaa-bbbb-ccccddddeeee', amount: 300000 },
      ]);
      expect(mockInterface.getCalendarsInFundingPlan.calledOnce).toBe(true);
      expect(mockInterface.getCalendarsInFundingPlan.calledWith('test-account-id')).toBe(true);
    });

    it('should return 401 when not authenticated', async () => {
      router.get('/handler', routes['getCalendars'].bind(routes));

      await request(testApp(router))
        .get('/handler')
        .expect(401);
    });

    it('should return empty array when user has no funding plan', async () => {
      mockInterface.getCalendarsInFundingPlan.resolves([]);

      bindGetCalendars();

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('should return empty array when user has funding plan but no calendars', async () => {
      mockInterface.getCalendarsInFundingPlan.resolves([]);

      bindGetCalendars();

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('should not include createdAt in response', async () => {
      mockInterface.getCalendarsInFundingPlan.resolves([
        { calendarId: 'cal-1-uuid-aaaa-bbbb-ccccddddeeee', amount: 500000, createdAt: new Date('2026-01-01') },
      ]);

      bindGetCalendars();

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body[0]).not.toHaveProperty('createdAt');
      expect(response.body[0]).toEqual({
        calendarId: 'cal-1-uuid-aaaa-bbbb-ccccddddeeee',
        amount: 500000,
      });
    });

    it('should return 500 when service throws unexpected error', async () => {
      mockInterface.getCalendarsInFundingPlan.rejects(new Error('Database error'));

      bindGetCalendars();

      const response = await request(testApp(router))
        .get('/handler')
        .expect(500);

      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('DELETE /calendars/:calendarId (removeCalendar)', () => {
    const bindRemoveCalendar = () => {
      router.delete('/handler/:calendarId', (req: Request, _res: Response, next) => {
        req.user = mockAccount;
        next();
      }, routes['removeCalendar'].bind(routes));
    };

    it('should return 200 on successful removal', async () => {
      mockInterface.removeCalendarFromFundingPlan.resolves();

      bindRemoveCalendar();

      const response = await request(testApp(router))
        .delete('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(mockInterface.removeCalendarFromFundingPlan.calledOnce).toBe(true);
      expect(mockInterface.removeCalendarFromFundingPlan.calledWith(
        'test-account-id',
        'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      )).toBe(true);
    });

    it('should return 401 when not authenticated', async () => {
      router.delete('/handler/:calendarId', routes['removeCalendar'].bind(routes));

      await request(testApp(router))
        .delete('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
        .expect(401);
    });

    it('should return 400 when calendarId is not a valid UUID', async () => {
      bindRemoveCalendar();

      const response = await request(testApp(router))
        .delete('/handler/not-a-uuid')
        .expect(400);

      expect(response.body.error).toContain('Invalid calendarId');
    });

    it('should return 404 when service throws FundingPlanNotFoundError', async () => {
      mockInterface.removeCalendarFromFundingPlan.rejects(
        new FundingPlanNotFoundError('test-account-id'),
      );

      bindRemoveCalendar();

      const response = await request(testApp(router))
        .delete('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
        .expect(404);

      expect(response.body.errorName).toBe('FundingPlanNotFoundError');
    });

    it('should return 404 when calendar funding plan not found', async () => {
      mockInterface.removeCalendarFromFundingPlan.rejects(
        new CalendarFundingPlanNotFoundError('sub-1', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'),
      );

      bindRemoveCalendar();

      const response = await request(testApp(router))
        .delete('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
        .expect(404);

      expect(response.body.errorName).toBe('CalendarFundingPlanNotFoundError');
    });

    it('should return 400 when service throws ValidationError', async () => {
      mockInterface.removeCalendarFromFundingPlan.rejects(
        new ValidationError('Account does not own this calendar'),
      );

      bindRemoveCalendar();

      const response = await request(testApp(router))
        .delete('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
        .expect(400);

      expect(response.body.errorName).toBe('ValidationError');
    });
  });

  describe('GET /calendars/:calendarId/funding (getFundingStatus)', () => {
    const bindGetFundingStatus = () => {
      router.get('/handler/:calendarId/funding', (req: Request, _res: Response, next) => {
        req.user = mockAccount;
        next();
      }, routes['getFundingStatus'].bind(routes));
    };

    /**
     * Resolve the summary the handler will project, with the given status.
     *
     * @param status - Unified single-calendar funding status
     * @param overrides - Extra summary fields to merge in
     */
    const resolveSummary = (status: string, overrides: Record<string, unknown> = {}) => {
      mockInterface.getCalendarFundingSummary.resolves({
        status,
        features: { widget_embedding: false },
        ...overrides,
      } as any);
    };

    it('should return 200 with funding status for calendar owner', async () => {
      resolveSummary('covered');

      bindGetFundingStatus();

      const response = await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(200);

      expect(response.body.status).toBe('covered');
      // Verify accountId is passed to getCalendarFundingSummary
      expect(mockInterface.getCalendarFundingSummary.calledWith(
        'test-account-id',
        'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      )).toBe(true);
    });

    it('should return the per-feature gate decisions', async () => {
      resolveSummary('covered', {
        features: { widget_embedding: true },
      });

      bindGetFundingStatus();

      const response = await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(200);

      expect(response.body.features).toEqual({ widget_embedding: true });
    });

    /**
     * The response is an explicit field allowlist, not a serialised model.
     *
     * FundingPlan.toObject() carries accountId, and the entity behind it holds
     * the Stripe customer and subscription ids. Handing any of those to a
     * caller would disclose who owns the plan and which Stripe objects back
     * it — for no benefit to the settings screen that reads this route.
     *
     * The test drives the point by resolving a summary deliberately polluted
     * with exactly those fields: a handler that spread the service's answer
     * into the response, or that ever went back to serialising the plan,
     * fails here. Asserting the key set rather than a handful of absences
     * means a field added to the service in future is caught too.
     */
    it('should never disclose account or Stripe identifiers, whatever the service returns', async () => {
      resolveSummary('covered', {
        accountId: 'owner-account-id',
        customerId: 'cus_leak',
        subscriptionId: 'sub_leak',
        providerCustomerId: 'cus_leak',
        providerSubscriptionId: 'sub_leak',
        providerConfigId: 'provider-config-id',
      });

      bindGetFundingStatus();

      const response = await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(200);

      expect(Object.keys(response.body).sort()).toEqual(
        ['features', 'status'],
      );

      const serialised = JSON.stringify(response.body);
      for (const secret of ['owner-account-id', 'cus_leak', 'sub_leak', 'provider-config-id']) {
        expect(serialised).not.toContain(secret);
      }
    });

    it('should report only registered funding-gated features', async () => {
      resolveSummary('covered', {
        features: { widget_embedding: true, unregistered_feature: true },
      });

      bindGetFundingStatus();

      const response = await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(200);

      expect(response.body.features).toEqual({ widget_embedding: true });
    });

    it('should return 401 when not authenticated', async () => {
      router.get('/handler/:calendarId/funding', routes['getFundingStatus'].bind(routes));

      await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(401);
    });

    /**
     * A calendar editor who is not the owner is refused here, not served a
     * redacted body: the service verifies ownership through
     * CalendarInterface.isCalendarOwnerById, which matches the membership role
     * 'owner' only (calendar.ts isCalendarOwnerById). Nothing about the
     * owner's funding — not even its existence — reaches a non-owner.
     */
    it('should return 400 when user does not own the calendar (ValidationError from service)', async () => {
      mockInterface.getCalendarFundingSummary.rejects(
        new ValidationError('Account does not own calendar'),
      );

      bindGetFundingStatus();

      const response = await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(400);

      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when calendarId is not a valid UUID', async () => {
      bindGetFundingStatus();

      const response = await request(testApp(router))
        .get('/handler/not-a-uuid/funding')
        .expect(400);

      expect(response.body.error).toContain('Invalid calendarId');
    });

    it('should return 404 when calendar does not exist', async () => {
      mockInterface.getCalendarFundingSummary.rejects(
        new CalendarNotFoundError('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'),
      );

      bindGetFundingStatus();

      const response = await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(404);

      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return admin_exempt status', async () => {
      resolveSummary('admin_exempt');

      bindGetFundingStatus();

      const response = await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(200);

      expect(response.body.status).toBe('admin_exempt');
    });

    /**
     * An unreadable funding state is a server-side failure, never an
     * "not covered" answer: telling an operator they are not covered during our own
     * outage invites them to pay to fix it.
     */
    it('should return 500 when the instance funding state cannot be read', async () => {
      mockInterface.getCalendarFundingSummary.rejects(
        new FundingAccessIndeterminateError('Instance funding settings could not be read'),
      );

      bindGetFundingStatus();

      const response = await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(500);

      expect(response.body.status).toBeUndefined();
    });

    it('should return not_covered status', async () => {
      resolveSummary('not_covered');

      bindGetFundingStatus();

      const response = await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(200);

      expect(response.body.status).toBe('not_covered');
    });
  });
});
