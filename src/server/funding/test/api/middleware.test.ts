import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

import { requireFundingAccess, isFundingAccessGate } from '@/server/funding/api/middleware';
import FundingInterface from '@/server/funding/interface';
import { FundingAccessIndeterminateError } from '@/common/exceptions/funding';
import { SubscriptionRequiredError } from '@/common/exceptions/subscription';
import { globalErrorHandler } from '@/server/common/middleware/error-handler';

/**
 * Tests for the requireFundingAccess Express middleware factory.
 *
 * Every case drives a real mounted route through supertest rather than
 * calling the middleware function directly: the composition contract this
 * middleware carries is about where it sits in an Express stack, and a
 * hand-built `req` object cannot fail the way a misconfigured route can.
 *
 * The routes here are synthetic because no product route is gated yet — the
 * widget-embedding call sites migrate onto this mechanism in pv-jdot.1.5. The
 * app is assembled the way the real server assembles one (scoped
 * `express.json()` per pv-ufag, router mounted under a prefix, the global
 * error handler last) so the stack under test matches production.
 */
describe('requireFundingAccess', () => {
  let sandbox: sinon.SinonSandbox;
  let fundingInterface: sinon.SinonStubbedInstance<FundingInterface>;
  let calendarId: string;
  let handlerCalls: number;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    fundingInterface = sandbox.createStubInstance(FundingInterface);
    calendarId = uuidv4();
    handlerCalls = 0;
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * Mounts a gated route the way a feature domain would: authentication and
   * ownership would run first (stubbed out here — this middleware is not an
   * authorization check and never stands in for one), then the gate, then the
   * handler.
   */
  function buildApp(
    routePath: string = '/calendars/:calendarId/widget',
    gate: express.RequestHandler = requireFundingAccess(
      fundingInterface as unknown as FundingInterface,
      'widget_embedding',
    ),
  ): express.Application {
    const app = express();
    app.use('/api/test/v1', express.json());

    const router = express.Router();
    router.post(routePath, gate, (_req, res) => {
      handlerCalls += 1;
      res.json({ reached: true });
    });
    app.use('/api/test/v1', router);
    app.use(globalErrorHandler);

    return app;
  }

  describe('gate open', () => {
    it('should pass the request through to the handler', async () => {
      fundingInterface.checkFundingAccess.resolves(true);

      const response = await request(buildApp())
        .post(`/api/test/v1/calendars/${calendarId}/widget`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ reached: true });
      expect(handlerCalls).toBe(1);
    });

    it('should ask about the calendar in the route param and the registered feature', async () => {
      fundingInterface.checkFundingAccess.resolves(true);

      await request(buildApp())
        .post(`/api/test/v1/calendars/${calendarId}/widget`)
        .send({});

      expect(fundingInterface.checkFundingAccess.calledOnceWithExactly(
        calendarId,
        'widget_embedding',
      )).toBe(true);
    });
  });

  describe('determinate denial: the calendar is unfunded', () => {
    it('should answer 402 with the SubscriptionRequiredError wire contract', async () => {
      fundingInterface.checkFundingAccess.resolves(false);

      const response = await request(buildApp())
        .post(`/api/test/v1/calendars/${calendarId}/widget`)
        .send({});

      expect(response.status).toBe(402);
      // Byte-for-byte the body the widget routes already return, so migrating
      // an existing gate onto this middleware is invisible to its clients —
      // including the anonymous embedder of an unfunded widget, whose current
      // rejection this preserves rather than changes.
      expect(response.body).toEqual({
        error: 'subscription_required',
        errorName: 'SubscriptionRequiredError',
        message: new SubscriptionRequiredError('widget_embedding').message,
        feature: 'widget_embedding',
      });
    });

    it('should not run the handler', async () => {
      fundingInterface.checkFundingAccess.resolves(false);

      await request(buildApp())
        .post(`/api/test/v1/calendars/${calendarId}/widget`)
        .send({});

      expect(handlerCalls).toBe(0);
    });
  });

  describe('indeterminate denial: the instance funding state is unreadable', () => {
    /**
     * The product constraint behind this block: an operator whose instance
     * never enabled funding must never be told, during a database outage,
     * that their community owes money (DEC-001). An indeterminate INSTANCE
     * state is our server error, not a commercial refusal.
     */
    it('should answer 5xx, never 402', async () => {
      fundingInterface.checkFundingAccess.rejects(
        new FundingAccessIndeterminateError('Instance funding settings could not be read'),
      );

      const response = await request(buildApp())
        .post(`/api/test/v1/calendars/${calendarId}/widget`)
        .send({});

      expect(response.status).toBe(500);
      expect(response.status).not.toBe(402);
      expect(handlerCalls).toBe(0);
    });

    it('should not name a subscription or a price anywhere in the response', async () => {
      fundingInterface.checkFundingAccess.rejects(
        new FundingAccessIndeterminateError('Instance funding settings could not be read'),
      );

      const response = await request(buildApp())
        .post(`/api/test/v1/calendars/${calendarId}/widget`)
        .send({});

      expect(response.body.errorName).not.toBe('SubscriptionRequiredError');
      expect(JSON.stringify(response.body)).not.toMatch(/subscription|funding|payment/i);
    });

    it('should answer 5xx for any other unexpected failure of the check', async () => {
      fundingInterface.checkFundingAccess.rejects(new Error('connection reset'));

      const response = await request(buildApp())
        .post(`/api/test/v1/calendars/${calendarId}/widget`)
        .send({});

      expect(response.status).toBe(500);
      expect(handlerCalls).toBe(0);
    });
  });

  describe('the feature key is fixed at route registration', () => {
    it('should ignore a feature supplied in the request body', async () => {
      fundingInterface.checkFundingAccess.resolves(false);

      const response = await request(buildApp())
        .post(`/api/test/v1/calendars/${calendarId}/widget`)
        .send({ feature: 'some_other_feature' });

      expect(fundingInterface.checkFundingAccess.calledOnceWithExactly(
        calendarId,
        'widget_embedding',
      )).toBe(true);
      expect(response.body.feature).toBe('widget_embedding');
    });

    it('should ignore a feature supplied in the query string', async () => {
      fundingInterface.checkFundingAccess.resolves(false);

      const response = await request(buildApp())
        .post(`/api/test/v1/calendars/${calendarId}/widget?feature=some_other_feature`)
        .send({});

      expect(fundingInterface.checkFundingAccess.calledOnceWithExactly(
        calendarId,
        'widget_embedding',
      )).toBe(true);
      expect(response.body.feature).toBe('widget_embedding');
    });

    it('should refuse to build a gate for a key that is not in the registry', () => {
      expect(() => requireFundingAccess(
        fundingInterface as unknown as FundingInterface,
        'made_up_feature' as any,
      )).toThrow(/registered funding-gated feature/);
    });
  });

  describe('the calendar comes from the route param and nowhere else', () => {
    it('should ignore a calendarId supplied in the request body', async () => {
      fundingInterface.checkFundingAccess.resolves(true);
      const bodyCalendarId = uuidv4();

      await request(buildApp())
        .post(`/api/test/v1/calendars/${calendarId}/widget`)
        .send({ calendarId: bodyCalendarId });

      expect(fundingInterface.checkFundingAccess.calledOnceWithExactly(
        calendarId,
        'widget_embedding',
      )).toBe(true);
    });

    it('should fail the request as a server error when the route has no such param', async () => {
      fundingInterface.checkFundingAccess.resolves(true);

      const response = await request(buildApp('/widget'))
        .post('/api/test/v1/widget')
        .send({ calendarId: uuidv4() });

      // A gate mounted on a route that cannot supply its calendar is our
      // misconfiguration, not the caller's unpaid bill.
      expect(response.status).toBe(500);
      expect(fundingInterface.checkFundingAccess.called).toBe(false);
      expect(handlerCalls).toBe(0);
    });

    it('should fail as a server error rather than 402 when the param is not a UUID', async () => {
      fundingInterface.checkFundingAccess.resolves(true);

      const response = await request(buildApp())
        .post('/api/test/v1/calendars/not-a-uuid/widget')
        .send({});

      // The contract is that the param was already UUID-validated upstream, so
      // reaching here means the composition is broken. Never 402: nothing has
      // been established about whether this calendar is funded.
      expect(response.status).toBe(500);
      expect(fundingInterface.checkFundingAccess.called).toBe(false);
      expect(handlerCalls).toBe(0);
    });

    it('should read a differently-named route param when one is configured', async () => {
      fundingInterface.checkFundingAccess.resolves(true);
      const gate = requireFundingAccess(
        fundingInterface as unknown as FundingInterface,
        'widget_embedding',
        'calendar',
      );

      const response = await request(buildApp('/calendars/:calendar/widget', gate))
        .post(`/api/test/v1/calendars/${calendarId}/widget`)
        .send({});

      expect(response.status).toBe(200);
      expect(fundingInterface.checkFundingAccess.calledOnceWithExactly(
        calendarId,
        'widget_embedding',
      )).toBe(true);
    });
  });

  describe('gate introspection', () => {
    it('should tag the middleware with the feature it gates', () => {
      const gate = requireFundingAccess(
        fundingInterface as unknown as FundingInterface,
        'widget_embedding',
      );

      expect(isFundingAccessGate(gate)).toBe(true);
      expect(gate.fundingGatedFeature).toBe('widget_embedding');
    });

    it('should not mistake an ordinary handler for a gate', () => {
      expect(isFundingAccessGate((_req: any, _res: any, next: any) => next())).toBe(false);
      expect(isFundingAccessGate(undefined)).toBe(false);
    });
  });
});
