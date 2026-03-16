import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import CheckoutSessionRoutes from '@/server/funding/api/v1/checkout-session';
import FundingInterface from '@/server/funding/interface';
import {
  ActiveFundingPlanExistsError,
  ProviderNotConfiguredError,
  InvalidSessionIdError,
  SubscriptionNotFoundError,
} from '@/server/funding/exceptions';
import { ValidationError } from '@/common/exceptions/base';

/**
 * Tests for Checkout Session API routes
 *
 * Tests the API endpoints for creating and checking status of
 * Stripe embedded checkout sessions.
 */
describe('Checkout Session API Routes', () => {
  let router: express.Router;
  let fundingInterface: FundingInterface;
  let routes: CheckoutSessionRoutes;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    router = express.Router();

    // Create a stub FundingInterface (avoid real constructor which needs EventEmitter)
    fundingInterface = {
      createCheckoutSession: sandbox.stub(),
      getCheckoutSessionStatus: sandbox.stub(),
    } as unknown as FundingInterface;

    routes = new CheckoutSessionRoutes(fundingInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('POST /checkout-sessions', () => {
    it('should create a checkout session successfully', async () => {
      (fundingInterface.createCheckoutSession as sinon.SinonStub).resolves({
        clientSecret: 'cs_secret_abc123',
        sessionId: 'cs_test_session123',
      });

      router.use(addRequestUser);
      router.post('/checkout-sessions', routes.createSession.bind(routes));

      const response = await request(testApp(router))
        .post('/checkout-sessions')
        .send({
          billing_cycle: 'monthly',
          return_url: 'https://example.com/return',
        })
        .expect(200);

      expect(response.body).toEqual({
        client_secret: 'cs_secret_abc123',
        session_id: 'cs_test_session123',
      });
    });

    it('should pass correct parameters to the interface', async () => {
      const createStub = fundingInterface.createCheckoutSession as sinon.SinonStub;
      createStub.resolves({
        clientSecret: 'cs_secret_abc123',
        sessionId: 'cs_test_session123',
      });

      router.use(addRequestUser);
      router.post('/checkout-sessions', routes.createSession.bind(routes));

      await request(testApp(router))
        .post('/checkout-sessions')
        .send({
          billing_cycle: 'yearly',
          return_url: 'https://example.com/return',
          amount: 500000,
          calendar_ids: ['550e8400-e29b-41d4-a716-446655440000'],
        })
        .expect(200);

      expect(createStub.calledOnce).toBe(true);
      const [accountId, billingCycle, returnUrl, amount, calendarIds] = createStub.firstCall.args;
      expect(accountId).toBe('id');
      expect(billingCycle).toBe('yearly');
      expect(returnUrl).toBe('https://example.com/return');
      expect(amount).toBe(500000);
      expect(calendarIds).toEqual(['550e8400-e29b-41d4-a716-446655440000']);
    });

    it('should return 400 when billing_cycle is missing', async () => {
      router.use(addRequestUser);
      router.post('/checkout-sessions', routes.createSession.bind(routes));

      const response = await request(testApp(router))
        .post('/checkout-sessions')
        .send({
          return_url: 'https://example.com/return',
        })
        .expect(400);

      expect(response.body.error).toContain('billing_cycle');
    });

    it('should return 400 when return_url is missing', async () => {
      router.use(addRequestUser);
      router.post('/checkout-sessions', routes.createSession.bind(routes));

      const response = await request(testApp(router))
        .post('/checkout-sessions')
        .send({
          billing_cycle: 'monthly',
        })
        .expect(400);

      expect(response.body.error).toContain('return_url');
    });

    it('should return 400 when calendar_ids is not an array', async () => {
      router.use(addRequestUser);
      router.post('/checkout-sessions', routes.createSession.bind(routes));

      const response = await request(testApp(router))
        .post('/checkout-sessions')
        .send({
          billing_cycle: 'monthly',
          return_url: 'https://example.com/return',
          calendar_ids: 'not-an-array',
        })
        .expect(400);

      expect(response.body.error).toContain('calendar_ids must be an array');
    });

    it('should return 400 when calendar_ids contains invalid UUIDs', async () => {
      router.use(addRequestUser);
      router.post('/checkout-sessions', routes.createSession.bind(routes));

      const response = await request(testApp(router))
        .post('/checkout-sessions')
        .send({
          billing_cycle: 'monthly',
          return_url: 'https://example.com/return',
          calendar_ids: ['not-a-uuid'],
        })
        .expect(400);

      expect(response.body.error).toContain('Invalid calendar IDs');
    });

    it('should return 409 when user already has an active funding plan', async () => {
      (fundingInterface.createCheckoutSession as sinon.SinonStub).rejects(
        new ActiveFundingPlanExistsError('id'),
      );

      router.use(addRequestUser);
      router.post('/checkout-sessions', routes.createSession.bind(routes));

      const response = await request(testApp(router))
        .post('/checkout-sessions')
        .send({
          billing_cycle: 'monthly',
          return_url: 'https://example.com/return',
        })
        .expect(409);

      expect(response.body.errorName).toBe('ActiveFundingPlanExistsError');
    });

    it('should return 404 when no provider is configured', async () => {
      (fundingInterface.createCheckoutSession as sinon.SinonStub).rejects(
        new ProviderNotConfiguredError(),
      );

      router.use(addRequestUser);
      router.post('/checkout-sessions', routes.createSession.bind(routes));

      const response = await request(testApp(router))
        .post('/checkout-sessions')
        .send({
          billing_cycle: 'monthly',
          return_url: 'https://example.com/return',
        })
        .expect(404);

      expect(response.body.errorName).toBe('ProviderNotConfiguredError');
    });

    it('should return 400 for validation errors from service', async () => {
      (fundingInterface.createCheckoutSession as sinon.SinonStub).rejects(
        new ValidationError('Invalid billing cycle'),
      );

      router.use(addRequestUser);
      router.post('/checkout-sessions', routes.createSession.bind(routes));

      const response = await request(testApp(router))
        .post('/checkout-sessions')
        .send({
          billing_cycle: 'invalid',
          return_url: 'https://example.com/return',
        })
        .expect(400);

      expect(response.body.error).toContain('Invalid billing cycle');
    });

    it('should return 500 for unexpected errors', async () => {
      (fundingInterface.createCheckoutSession as sinon.SinonStub).rejects(
        new Error('Stripe API error'),
      );

      router.use(addRequestUser);
      router.post('/checkout-sessions', routes.createSession.bind(routes));

      const response = await request(testApp(router))
        .post('/checkout-sessions')
        .send({
          billing_cycle: 'monthly',
          return_url: 'https://example.com/return',
        })
        .expect(500);

      expect(response.body.error).toBe('Internal server error');
    });

    it('should return 401 when not authenticated', async () => {
      router.post('/checkout-sessions', routes.createSession.bind(routes));

      const response = await request(testApp(router))
        .post('/checkout-sessions')
        .send({
          billing_cycle: 'monthly',
          return_url: 'https://example.com/return',
        })
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });
  });

  describe('GET /checkout-sessions/:sessionId/status', () => {
    it('should return session status successfully', async () => {
      (fundingInterface.getCheckoutSessionStatus as sinon.SinonStub).resolves({
        status: 'complete',
      });

      router.use(addRequestUser);
      router.get('/checkout-sessions/:sessionId/status', routes.getSessionStatus.bind(routes));

      const response = await request(testApp(router))
        .get('/checkout-sessions/cs_test_abc123/status')
        .expect(200);

      expect(response.body).toEqual({ status: 'complete' });
    });

    it('should pass correct parameters to the interface', async () => {
      const getStatusStub = fundingInterface.getCheckoutSessionStatus as sinon.SinonStub;
      getStatusStub.resolves({ status: 'open' });

      router.use(addRequestUser);
      router.get('/checkout-sessions/:sessionId/status', routes.getSessionStatus.bind(routes));

      await request(testApp(router))
        .get('/checkout-sessions/cs_test_session456/status')
        .expect(200);

      expect(getStatusStub.calledOnce).toBe(true);
      const [accountId, sessionId] = getStatusStub.firstCall.args;
      expect(accountId).toBe('id');
      expect(sessionId).toBe('cs_test_session456');
    });

    it('should return 400 for invalid session ID format', async () => {
      (fundingInterface.getCheckoutSessionStatus as sinon.SinonStub).rejects(
        new InvalidSessionIdError('Invalid session ID format'),
      );

      router.use(addRequestUser);
      router.get('/checkout-sessions/:sessionId/status', routes.getSessionStatus.bind(routes));

      const response = await request(testApp(router))
        .get('/checkout-sessions/invalid-session-id/status')
        .expect(400);

      expect(response.body.errorName).toBe('InvalidSessionIdError');
    });

    it('should return 404 when session not found or IDOR mismatch', async () => {
      (fundingInterface.getCheckoutSessionStatus as sinon.SinonStub).rejects(
        new SubscriptionNotFoundError('cs_test_abc123'),
      );

      router.use(addRequestUser);
      router.get('/checkout-sessions/:sessionId/status', routes.getSessionStatus.bind(routes));

      const response = await request(testApp(router))
        .get('/checkout-sessions/cs_test_abc123/status')
        .expect(404);

      expect(response.body.errorName).toBe('SubscriptionNotFoundError');
    });

    it('should return 404 when no provider is configured', async () => {
      (fundingInterface.getCheckoutSessionStatus as sinon.SinonStub).rejects(
        new ProviderNotConfiguredError(),
      );

      router.use(addRequestUser);
      router.get('/checkout-sessions/:sessionId/status', routes.getSessionStatus.bind(routes));

      const response = await request(testApp(router))
        .get('/checkout-sessions/cs_test_abc123/status')
        .expect(404);

      expect(response.body.errorName).toBe('ProviderNotConfiguredError');
    });

    it('should return 500 for unexpected errors', async () => {
      (fundingInterface.getCheckoutSessionStatus as sinon.SinonStub).rejects(
        new Error('Stripe API error'),
      );

      router.use(addRequestUser);
      router.get('/checkout-sessions/:sessionId/status', routes.getSessionStatus.bind(routes));

      const response = await request(testApp(router))
        .get('/checkout-sessions/cs_test_abc123/status')
        .expect(500);

      expect(response.body.error).toBe('Internal server error');
    });

    it('should return 401 when not authenticated', async () => {
      router.get('/checkout-sessions/:sessionId/status', routes.getSessionStatus.bind(routes));

      const response = await request(testApp(router))
        .get('/checkout-sessions/cs_test_abc123/status')
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });
  });
});
