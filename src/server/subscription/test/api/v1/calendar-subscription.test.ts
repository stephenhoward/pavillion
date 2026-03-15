import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import sinon from 'sinon';
import CalendarSubscriptionRoutes from '@/server/subscription/api/v1/calendar-subscription';
import SubscriptionInterface from '@/server/subscription/interface';
import { Account } from '@/common/model/account';
import { Subscription } from '@/common/model/subscription';
import { testApp } from '@/server/common/test/lib/express';
import {
  SubscriptionNotFoundError,
  CalendarSubscriptionNotFoundError,
  DuplicateCalendarSubscriptionError,
  CalendarNotFoundError,
} from '@/server/subscription/exceptions';
import { ValidationError } from '@/common/exceptions/base';

/**
 * Tests for CalendarSubscriptionRoutes API handlers.
 *
 * These tests verify the HTTP-level behavior of POST /calendars,
 * DELETE /calendars/:calendarId, and GET /calendars/:calendarId/funding
 * without rate limiting middleware (bypassed via direct handler binding).
 */
describe('CalendarSubscriptionRoutes API', () => {
  let sandbox: sinon.SinonSandbox;
  let router: express.Router;
  let mockInterface: sinon.SinonStubbedInstance<SubscriptionInterface>;
  let routes: CalendarSubscriptionRoutes;
  let mockAccount: Account;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    router = express.Router();

    // Create a stub of SubscriptionInterface
    mockInterface = sandbox.createStubInstance(SubscriptionInterface);
    routes = new CalendarSubscriptionRoutes(mockInterface as any);

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
      mockInterface.addCalendarToSubscription.resolves();

      bindAddCalendar();

      const response = await request(testApp(router))
        .post('/handler')
        .send({
          calendarId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
          amount: 500000,
        })
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(mockInterface.addCalendarToSubscription.calledOnce).toBe(true);
      expect(mockInterface.addCalendarToSubscription.calledWith(
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

    it('should return 404 when service throws SubscriptionNotFoundError', async () => {
      mockInterface.addCalendarToSubscription.rejects(
        new SubscriptionNotFoundError('test-account-id'),
      );

      bindAddCalendar();

      const response = await request(testApp(router))
        .post('/handler')
        .send({ calendarId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', amount: 500000 })
        .expect(404);

      expect(response.body.errorName).toBe('SubscriptionNotFoundError');
    });

    it('should return 409 when calendar already has an active subscription', async () => {
      mockInterface.addCalendarToSubscription.rejects(
        new DuplicateCalendarSubscriptionError('sub-1', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'),
      );

      bindAddCalendar();

      const response = await request(testApp(router))
        .post('/handler')
        .send({ calendarId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', amount: 500000 })
        .expect(409);

      expect(response.body.errorName).toBe('DuplicateCalendarSubscriptionError');
    });

    it('should return 404 when calendar does not exist', async () => {
      mockInterface.addCalendarToSubscription.rejects(
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
      mockInterface.addCalendarToSubscription.rejects(
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

  describe('DELETE /calendars/:calendarId (removeCalendar)', () => {
    const bindRemoveCalendar = () => {
      router.delete('/handler/:calendarId', (req: Request, _res: Response, next) => {
        req.user = mockAccount;
        next();
      }, routes['removeCalendar'].bind(routes));
    };

    it('should return 200 on successful removal', async () => {
      mockInterface.removeCalendarFromSubscription.resolves();

      bindRemoveCalendar();

      const response = await request(testApp(router))
        .delete('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(mockInterface.removeCalendarFromSubscription.calledOnce).toBe(true);
      expect(mockInterface.removeCalendarFromSubscription.calledWith(
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

    it('should return 404 when service throws SubscriptionNotFoundError', async () => {
      mockInterface.removeCalendarFromSubscription.rejects(
        new SubscriptionNotFoundError('test-account-id'),
      );

      bindRemoveCalendar();

      const response = await request(testApp(router))
        .delete('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
        .expect(404);

      expect(response.body.errorName).toBe('SubscriptionNotFoundError');
    });

    it('should return 404 when calendar subscription not found', async () => {
      mockInterface.removeCalendarFromSubscription.rejects(
        new CalendarSubscriptionNotFoundError('sub-1', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'),
      );

      bindRemoveCalendar();

      const response = await request(testApp(router))
        .delete('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
        .expect(404);

      expect(response.body.errorName).toBe('CalendarSubscriptionNotFoundError');
    });

    it('should return 400 when service throws ValidationError', async () => {
      mockInterface.removeCalendarFromSubscription.rejects(
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

    it('should return 200 with funding status for calendar owner', async () => {
      mockInterface.getFundingStatusForCalendar.resolves('funded' as any);

      bindGetFundingStatus();

      const response = await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(200);

      expect(response.body.calendarId).toBe('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d');
      expect(response.body.fundingStatus).toBe('funded');
      // Verify accountId is passed to getFundingStatusForCalendar
      expect(mockInterface.getFundingStatusForCalendar.calledWith(
        'test-account-id',
        'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      )).toBe(true);
    });

    it('should return 401 when not authenticated', async () => {
      router.get('/handler/:calendarId/funding', routes['getFundingStatus'].bind(routes));

      await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(401);
    });

    it('should return 400 when user does not own the calendar (ValidationError from service)', async () => {
      mockInterface.getFundingStatusForCalendar.rejects(
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
      mockInterface.getFundingStatusForCalendar.rejects(
        new CalendarNotFoundError('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'),
      );

      bindGetFundingStatus();

      const response = await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(404);

      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return admin-exempt status', async () => {
      mockInterface.getFundingStatusForCalendar.resolves('admin-exempt' as any);

      bindGetFundingStatus();

      const response = await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(200);

      expect(response.body.fundingStatus).toBe('admin-exempt');
    });

    it('should return unfunded status', async () => {
      mockInterface.getFundingStatusForCalendar.resolves('unfunded' as any);

      bindGetFundingStatus();

      const response = await request(testApp(router))
        .get('/handler/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/funding')
        .expect(200);

      expect(response.body.fundingStatus).toBe('unfunded');
    });
  });
});
