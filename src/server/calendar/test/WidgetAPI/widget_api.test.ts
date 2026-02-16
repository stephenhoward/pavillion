import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import express, { Application } from 'express';
import supertest from 'supertest';

import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import WidgetDomainService from '@/server/calendar/service/widget_domain';
import WidgetRoutes from '@/server/calendar/api/v1/widget';

describe('Widget API Routes', () => {
  let app: Application;
  let sandbox = sinon.createSandbox();
  let mockInterface: CalendarInterface;
  let mockWidgetService: WidgetDomainService;
  let widgetRoutes: WidgetRoutes;
  let calendar: Calendar;

  beforeEach(() => {
    // Create express app for testing
    app = express();
    app.use(express.json());

    // Create mock calendar interface and services
    mockInterface = {
      getCalendarByName: sandbox.stub(),
      getCalendarForWidget: sandbox.stub(),
    } as any;

    mockWidgetService = new WidgetDomainService();
    calendar = new Calendar('calendar-id-123', 'test-calendar');

    // Create widget routes and install
    widgetRoutes = new WidgetRoutes(mockInterface, mockWidgetService);
    widgetRoutes.installHandlers(app, '/api/widget/v1');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Origin validation on widget calendar endpoint', () => {
    it('should allow request from localhost without configuration', async () => {
      const getCalendarStub = mockInterface.getCalendarByName as sinon.SinonStub;
      const getCalendarForWidgetStub = mockInterface.getCalendarForWidget as sinon.SinonStub;
      getCalendarStub.resolves(calendar);
      getCalendarForWidgetStub.resolves(calendar);

      const response = await supertest(app)
        .get('/api/widget/v1/calendars/test-calendar')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      expect(response.body).toHaveProperty('id', calendar.id);
      expect(response.body).toHaveProperty('urlName', calendar.urlName);
    });

    it('should allow request from 127.0.0.1 without configuration', async () => {
      const getCalendarStub = mockInterface.getCalendarByName as sinon.SinonStub;
      const getCalendarForWidgetStub = mockInterface.getCalendarForWidget as sinon.SinonStub;
      getCalendarStub.resolves(calendar);
      getCalendarForWidgetStub.resolves(calendar);

      const response = await supertest(app)
        .get('/api/widget/v1/calendars/test-calendar')
        .set('Origin', 'http://127.0.0.1:8080')
        .expect(200);

      expect(response.body).toHaveProperty('id', calendar.id);
    });

    it('should allow request from allowed domain', async () => {
      const getCalendarStub = mockInterface.getCalendarByName as sinon.SinonStub;
      const getCalendarForWidgetStub = mockInterface.getCalendarForWidget as sinon.SinonStub;
      getCalendarStub.resolves(calendar);
      getCalendarForWidgetStub.resolves(calendar);

      const isOriginAllowedStub = sandbox.stub(mockWidgetService, 'isOriginAllowed');
      isOriginAllowedStub.resolves(true);

      const response = await supertest(app)
        .get('/api/widget/v1/calendars/test-calendar')
        .set('Origin', 'https://example.com')
        .expect(200);

      expect(response.body).toHaveProperty('id', calendar.id);
      expect(isOriginAllowedStub.calledOnce).toBe(true);
    });

    it('should return 403 for unauthorized domain', async () => {
      const getCalendarStub = mockInterface.getCalendarByName as sinon.SinonStub;
      const getCalendarForWidgetStub = mockInterface.getCalendarForWidget as sinon.SinonStub;
      getCalendarStub.resolves(calendar);
      getCalendarForWidgetStub.resolves(calendar);

      const isOriginAllowedStub = sandbox.stub(mockWidgetService, 'isOriginAllowed');
      isOriginAllowedStub.resolves(false);

      const response = await supertest(app)
        .get('/api/widget/v1/calendars/test-calendar')
        .set('Origin', 'https://malicious.com')
        .expect(403);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('not authorized');
    });

    it('should return 403 when no Origin header provided', async () => {
      const getCalendarStub = mockInterface.getCalendarByName as sinon.SinonStub;
      const getCalendarForWidgetStub = mockInterface.getCalendarForWidget as sinon.SinonStub;
      getCalendarStub.resolves(calendar);
      getCalendarForWidgetStub.resolves(calendar);

      const response = await supertest(app)
        .get('/api/widget/v1/calendars/test-calendar')
        .expect(403);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Origin header');
    });
  });

  describe('Dynamic CSP frame-ancestors header generation', () => {
    it('should set CSP header with requesting domain for allowed origin', async () => {
      const getCalendarStub = mockInterface.getCalendarByName as sinon.SinonStub;
      const getCalendarForWidgetStub = mockInterface.getCalendarForWidget as sinon.SinonStub;
      getCalendarStub.resolves(calendar);
      getCalendarForWidgetStub.resolves(calendar);

      const isOriginAllowedStub = sandbox.stub(mockWidgetService, 'isOriginAllowed');
      isOriginAllowedStub.resolves(true);

      const response = await supertest(app)
        .get('/api/widget/v1/calendars/test-calendar')
        .set('Origin', 'https://example.com')
        .expect(200);

      const cspHeader = response.headers['content-security-policy'];
      expect(cspHeader).toBeDefined();
      expect(cspHeader).toContain('frame-ancestors');
      expect(cspHeader).toContain('https://example.com');
    });

    it('should set CSP header with localhost for localhost requests', async () => {
      const getCalendarStub = mockInterface.getCalendarByName as sinon.SinonStub;
      const getCalendarForWidgetStub = mockInterface.getCalendarForWidget as sinon.SinonStub;
      getCalendarStub.resolves(calendar);
      getCalendarForWidgetStub.resolves(calendar);

      const response = await supertest(app)
        .get('/api/widget/v1/calendars/test-calendar')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      const cspHeader = response.headers['content-security-policy'];
      expect(cspHeader).toBeDefined();
      expect(cspHeader).toContain('frame-ancestors');
      expect(cspHeader).toContain('http://localhost:3000');
    });

    it('should set CORS Allow-Origin header for validated domain', async () => {
      const getCalendarStub = mockInterface.getCalendarByName as sinon.SinonStub;
      const getCalendarForWidgetStub = mockInterface.getCalendarForWidget as sinon.SinonStub;
      getCalendarStub.resolves(calendar);
      getCalendarForWidgetStub.resolves(calendar);

      const isOriginAllowedStub = sandbox.stub(mockWidgetService, 'isOriginAllowed');
      isOriginAllowedStub.resolves(true);

      const response = await supertest(app)
        .get('/api/widget/v1/calendars/test-calendar')
        .set('Origin', 'https://example.com')
        .expect(200);

      const corsHeader = response.headers['access-control-allow-origin'];
      expect(corsHeader).toBe('https://example.com');
    });
  });

  describe('Calendar not found handling', () => {
    it('should return 404 when calendar does not exist', async () => {
      const getCalendarStub = mockInterface.getCalendarByName as sinon.SinonStub;
      const getCalendarForWidgetStub = mockInterface.getCalendarForWidget as sinon.SinonStub;
      getCalendarStub.resolves(null);
      getCalendarForWidgetStub.resolves(null);

      const response = await supertest(app)
        .get('/api/widget/v1/calendars/nonexistent')
        .set('Origin', 'http://localhost')
        .expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('not found');
    });
  });

  describe('Subscription gating for widget data', () => {
    it('should return 402 when calendar owner lacks subscription', async () => {
      const getCalendarByNameStub = mockInterface.getCalendarByName as sinon.SinonStub;
      getCalendarByNameStub.resolves(calendar);

      // Mock getCalendarForWidget to throw SubscriptionRequiredError
      const { SubscriptionRequiredError } = await import('@/common/exceptions/subscription');
      const getCalendarForWidgetStub = sandbox.stub();
      getCalendarForWidgetStub.rejects(new SubscriptionRequiredError('widget_embedding'));
      mockInterface.getCalendarForWidget = getCalendarForWidgetStub;

      const response = await supertest(app)
        .get('/api/widget/v1/calendars/test-calendar')
        .set('Origin', 'http://localhost:3000')
        .expect(402);

      expect(response.body).toHaveProperty('error', 'subscription_required');
      expect(response.body).toHaveProperty('errorName', 'SubscriptionRequiredError');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('feature', 'widget_embedding');
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('should include CORS headers in 402 response', async () => {
      const getCalendarByNameStub = mockInterface.getCalendarByName as sinon.SinonStub;
      getCalendarByNameStub.resolves(calendar);

      const { SubscriptionRequiredError } = await import('@/common/exceptions/subscription');
      const getCalendarForWidgetStub = sandbox.stub();
      getCalendarForWidgetStub.rejects(new SubscriptionRequiredError('widget_embedding'));
      mockInterface.getCalendarForWidget = getCalendarForWidgetStub;

      const isOriginAllowedStub = sandbox.stub(mockWidgetService, 'isOriginAllowed');
      isOriginAllowedStub.resolves(true);

      const response = await supertest(app)
        .get('/api/widget/v1/calendars/test-calendar')
        .set('Origin', 'https://example.com')
        .expect(402);

      // CORS headers should be set by validateOrigin middleware
      expect(response.headers['access-control-allow-origin']).toBe('https://example.com');
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('should serve data when calendar owner has active subscription', async () => {
      const getCalendarByNameStub = mockInterface.getCalendarByName as sinon.SinonStub;
      getCalendarByNameStub.resolves(calendar);

      // Mock getCalendarForWidget to succeed
      const getCalendarForWidgetStub = sandbox.stub();
      getCalendarForWidgetStub.resolves(calendar);
      mockInterface.getCalendarForWidget = getCalendarForWidgetStub;

      const response = await supertest(app)
        .get('/api/widget/v1/calendars/test-calendar')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      expect(response.body).toHaveProperty('id', calendar.id);
      expect(response.body).toHaveProperty('urlName', calendar.urlName);
    });
  });
});
