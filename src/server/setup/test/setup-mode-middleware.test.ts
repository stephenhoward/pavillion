import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import sinon from 'sinon';
import express, { Request, Response } from 'express';
import request from 'supertest';

import SetupService from '@/server/setup/service/setup';
import SetupInterface from '@/server/setup/interface';
import { createSetupModeMiddleware } from '@/server/setup/middleware/setup-mode';

describe('Setup Mode Middleware', () => {
  let sandbox = sinon.createSandbox();
  let app: express.Application;
  let setupInterface: SetupInterface;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    setupInterface = new SetupInterface();
  });

  afterEach(() => {
    sandbox.restore();
    SetupService.clearCache();
  });

  describe('when setup mode is active (no admin exists)', () => {
    beforeEach(() => {
      // Stub isSetupModeActive to return true (setup required)
      sandbox.stub(SetupService.prototype, 'isSetupModeActive').resolves(true);

      // Add the middleware
      const middleware = createSetupModeMiddleware(setupInterface);
      app.use(middleware);

      // Add test routes after middleware
      app.get('/setup', (_req: Request, res: Response) => {
        res.status(200).json({ page: 'setup' });
      });
      app.get('/api/v1/setup/status', (_req: Request, res: Response) => {
        res.status(200).json({ setupRequired: true });
      });
      app.post('/api/v1/setup', (_req: Request, res: Response) => {
        res.status(200).json({ success: true });
      });
      app.get('/health', (_req: Request, res: Response) => {
        res.status(200).json({ status: 'healthy' });
      });
      app.get('/assets/test.js', (_req: Request, res: Response) => {
        res.status(200).send('// js file');
      });
      app.get('/login', (_req: Request, res: Response) => {
        res.status(200).json({ page: 'login' });
      });
      app.get('/api/v1/calendars', (_req: Request, res: Response) => {
        res.status(200).json({ calendars: [] });
      });
      app.get('/@test/calendar', (_req: Request, res: Response) => {
        res.status(200).json({ page: 'public calendar' });
      });
    });

    it('should redirect browser requests to /setup when in setup mode', async () => {
      const response = await request(app)
        .get('/login')
        .set('Accept', 'text/html')
        .expect(302);

      expect(response.headers.location).toBe('/setup');
    });

    it('should return 503 for API requests when in setup mode', async () => {
      const response = await request(app)
        .get('/api/v1/calendars')
        .set('Accept', 'application/json')
        .expect(503);

      expect(response.body.error).toBe('Setup required');
    });

    it('should allow /setup, /api/v1/setup/*, /health, and static assets', async () => {
      // /setup should be allowed
      const setupResponse = await request(app)
        .get('/setup')
        .expect(200);
      expect(setupResponse.body.page).toBe('setup');

      // /api/v1/setup/status should be allowed
      const statusResponse = await request(app)
        .get('/api/v1/setup/status')
        .expect(200);
      expect(statusResponse.body.setupRequired).toBe(true);

      // POST /api/v1/setup should be allowed
      const postSetupResponse = await request(app)
        .post('/api/v1/setup')
        .send({ email: 'test@test.com' })
        .expect(200);
      expect(postSetupResponse.body.success).toBe(true);

      // /health should be allowed
      const healthResponse = await request(app)
        .get('/health')
        .expect(200);
      expect(healthResponse.body.status).toBe('healthy');

      // /assets/* should be allowed
      const assetsResponse = await request(app)
        .get('/assets/test.js')
        .expect(200);
      expect(assetsResponse.text).toBe('// js file');
    });
  });

  describe('when setup is complete (admin exists)', () => {
    beforeEach(() => {
      // Stub isSetupModeActive to return false (setup complete)
      sandbox.stub(SetupService.prototype, 'isSetupModeActive').resolves(false);

      // Add the middleware
      const middleware = createSetupModeMiddleware(setupInterface);
      app.use(middleware);

      // Add test routes after middleware
      app.get('/setup', (_req: Request, res: Response) => {
        res.status(200).json({ page: 'setup' });
      });
      app.get('/login', (_req: Request, res: Response) => {
        res.status(200).json({ page: 'login' });
      });
      app.get('/api/v1/calendars', (_req: Request, res: Response) => {
        res.status(200).json({ calendars: [] });
      });
    });

    it('should pass through normally when setup is complete', async () => {
      // Regular routes should work
      const loginResponse = await request(app)
        .get('/login')
        .set('Accept', 'text/html')
        .expect(200);
      expect(loginResponse.body.page).toBe('login');

      // API routes should work
      const apiResponse = await request(app)
        .get('/api/v1/calendars')
        .set('Accept', 'application/json')
        .expect(200);
      expect(apiResponse.body.calendars).toEqual([]);
    });

    it('should return 404 for /setup when admin exists', async () => {
      const response = await request(app)
        .get('/setup')
        .expect(404);

      expect(response.body.error).toBe('Not found');
    });
  });
});
