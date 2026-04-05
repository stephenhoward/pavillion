import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import sinon from 'sinon';
import CalendarFundingPlanRoutes from '@/server/funding/api/v1/calendar-funding-plan';
import FundingInterface from '@/server/funding/interface';
import { Account } from '@/common/model/account';
import { FundingPlan } from '@/common/model/funding-plan';
import { testApp } from '@/server/common/test/lib/express';
import {
  FundingPlanNotFoundError,
  CalendarFundingPlanNotFoundError,
  DuplicateCalendarFundingPlanError,
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

    it('should return 200 with array of funded calendars', async () => {
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
