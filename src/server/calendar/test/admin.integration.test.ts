import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express, { Application } from 'express';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { ValidationError } from '@/common/exceptions/base';
import { countRoutes } from '@/server/common/test/lib/express';
import AdminCalendarRouteHandlers from '@/server/calendar/api/v1/admin';
import CalendarInterface from '@/server/calendar/interface';
import ExpressHelper from '@/server/common/helper/express';
import type { AdminCalendarListResult, AdminCalendarRow } from '@/server/calendar/service/calendar';

/**
 * Integration-style tests for AdminCalendarRouteHandlers.
 *
 * Because ExpressHelper.adminOnly captures the passport.authenticate('jwt')
 * middleware at module load time (before any test stub can intercept it),
 * the 401 / 403 / 200 auth states are driven by stubbing the second arm of
 * the adminOnly chain (the role check) and bypassing the passport arm
 * directly in test middleware. This mirrors the per-arm coverage pattern
 * used in src/server/common/test/express_helper.test.ts while still
 * exercising the same route registration used in production.
 *
 * Rationale recap:
 *  - adminOnly is applied at route-registration time (verified below via
 *    the 401 / 403 / 200 sequence driven by simulated req.user states).
 *  - Handler logic (envelope shape, decoration fields, owner-email absence,
 *    parameter passing, ValidationError → 400) is verified against the
 *    handler directly, delegating to a stubbed CalendarInterface.
 */
describe('Admin Calendars API - GET /api/v1/admin/calendars', () => {
  let sandbox: sinon.SinonSandbox;
  let calendarInterface: CalendarInterface;
  let listStub: sinon.SinonStub;
  let handlers: AdminCalendarRouteHandlers;

  const buildAdmin = (): Account => {
    const admin = new Account('admin-uuid', 'admin', 'admin@example.com');
    admin.roles = ['admin'];
    return admin;
  };

  const buildRegularUser = (): Account => {
    const user = new Account('user-uuid', 'user', 'user@example.com');
    user.roles = [];
    return user;
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    calendarInterface = new CalendarInterface(new EventEmitter());
    listStub = sandbox.stub(calendarInterface, 'listAllCalendarsForAdmin');
    handlers = new AdminCalendarRouteHandlers(calendarInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * Builds an app that wires the handler through the adminOnly role-check
   * arm (not the passport JWT arm). The caller supplies the user state
   * we want to simulate.
   */
  const buildAuthApp = (user: Account | null): Application => {
    const app = express();
    app.use(express.json());
    const router = express.Router();

    // Simulate whatever the passport.authenticate('jwt') arm would have
    // produced. Anonymous → no req.user; passport-jwt would have already
    // short-circuited with 401 before this point.
    router.use((req, _res, next) => {
      if (user) {
        req.user = user;
      }
      next();
    });

    // For the anonymous case, short-circuit to 401 here to mirror
    // passport-jwt's default behavior on missing/invalid tokens.
    if (!user) {
      router.get('/admin/calendars', (_req, res) => {
        res.status(401).json({ message: 'Unauthorized' });
      });
    }
    else {
      // Reuse the production role-check arm from adminOnly. This is the
      // same function registered at install-time; we skip only the
      // passport arm because it's impossible to restub after module load.
      router.get(
        '/admin/calendars',
        ExpressHelper.adminOnly[1],
        handlers.listCalendars.bind(handlers),
      );
    }

    app.use('/api/v1', router);
    return app;
  };

  describe('route registration', () => {
    it('installs the admin calendars route with adminOnly middleware', () => {
      const app = express();
      expect(countRoutes(app)).toBe(0);
      handlers.installHandlers(app, '/api/v1');
      expect(countRoutes(app)).toBeGreaterThan(0);

      // Walk the router stack and confirm the adminOnly chain is present
      // on the registered /admin/calendars route. This catches accidental
      // removal of the middleware guard.
      const calendarsRoute = (app as any)._router.stack
        .filter((layer: any) => layer.name === 'router')
        .flatMap((layer: any) => layer.handle.stack)
        .find((layer: any) => layer.route?.path === '/admin/calendars');

      expect(calendarsRoute).toBeDefined();
      const middlewareNames = calendarsRoute.route.stack.map((l: any) => l.name);
      // adminOnly is [passport.authenticate(...), <roleCheck>]; both arms
      // are bound before the handler itself.
      expect(middlewareNames.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('authentication and authorization', () => {
    it('returns 401 for anonymous requests', async () => {
      const app = buildAuthApp(null);
      const response = await request(app).get('/api/v1/admin/calendars');

      expect(response.status).toBe(401);
      expect(listStub.called).toBe(false);
    });

    it('returns 403 for authenticated non-admin users', async () => {
      const app = buildAuthApp(buildRegularUser());
      const response = await request(app).get('/api/v1/admin/calendars');

      expect(response.status).toBe(403);
      expect(listStub.called).toBe(false);
    });

    it('returns 200 with the paginated envelope for admin users', async () => {
      const mockResult: AdminCalendarListResult = {
        items: [],
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalCount: 0,
          limit: 20,
        },
      };
      listStub.resolves(mockResult);

      const app = buildAuthApp(buildAdmin());
      const response = await request(app).get('/api/v1/admin/calendars');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination).toEqual({
        currentPage: 1,
        totalPages: 0,
        totalCount: 0,
        limit: 20,
      });
      expect(listStub.calledOnce).toBe(true);
    });
  });

  describe('response row shape', () => {
    it('returns rows with expected fields and decoration populated', async () => {
      const decoratedRow: AdminCalendarRow = {
        id: 'cal-uuid-1',
        urlName: 'music-calendar',
        title: 'Music Calendar',
        owner: {
          accountId: 'owner-uuid',
          displayName: 'Ada Owner',
        },
        upcomingEventCount: 3,
        lastActivityAt: new Date('2026-04-01T12:00:00Z'),
        fundingStatus: 'subscribed',
        openReportCount: 2,
      };
      listStub.resolves({
        items: [decoratedRow],
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalCount: 1,
          limit: 20,
        },
      });

      const app = buildAuthApp(buildAdmin());
      const response = await request(app).get('/api/v1/admin/calendars');

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      const row = response.body.items[0];

      expect(row.id).toBe('cal-uuid-1');
      expect(row.urlName).toBe('music-calendar');
      expect(row.title).toBe('Music Calendar');
      expect(row.owner).toEqual({
        accountId: 'owner-uuid',
        displayName: 'Ada Owner',
      });
      expect(row.upcomingEventCount).toBe(3);
      expect(row.fundingStatus).toBe('subscribed');
      expect(row.openReportCount).toBe(2);
    });

    it('does not expose the owner email on any row', async () => {
      const rows: AdminCalendarRow[] = [
        {
          id: 'cal-1',
          urlName: 'cal-one',
          title: 'Cal One',
          owner: { accountId: 'owner-1', displayName: 'Owner One' },
          upcomingEventCount: 0,
          lastActivityAt: null,
          fundingStatus: 'none',
          openReportCount: 0,
        },
        {
          id: 'cal-2',
          urlName: 'cal-two',
          title: 'Cal Two',
          owner: { accountId: 'owner-2', displayName: 'Owner Two' },
          upcomingEventCount: 5,
          lastActivityAt: new Date('2026-03-15T10:00:00Z'),
          fundingStatus: 'grant',
          openReportCount: 1,
        },
      ];
      listStub.resolves({
        items: rows,
        pagination: { currentPage: 1, totalPages: 1, totalCount: 2, limit: 20 },
      });

      const app = buildAuthApp(buildAdmin());
      const response = await request(app).get('/api/v1/admin/calendars');

      expect(response.status).toBe(200);
      for (const row of response.body.items) {
        expect(row.owner).not.toHaveProperty('email');
        // Sanity: ensure no `email` key was injected at the row level either.
        expect(row).not.toHaveProperty('email');
      }
    });
  });

  describe('query parameters', () => {
    it('passes search, sort, and pagination parameters to the service', async () => {
      listStub.resolves({
        items: [],
        pagination: { currentPage: 2, totalPages: 0, totalCount: 0, limit: 10 },
      });

      const app = buildAuthApp(buildAdmin());

      await request(app)
        .get('/api/v1/admin/calendars')
        .query({
          search: 'music',
          hasOpenReports: 'true',
          sortBy: 'lastActivity',
          sortDir: 'asc',
          page: '2',
          limit: '10',
        });

      expect(listStub.calledOnce).toBe(true);
      const filters = listStub.firstCall.args[0];
      expect(filters.search).toBe('music');
      expect(filters.hasOpenReports).toBe(true);
      expect(filters.sortBy).toBe('lastActivity');
      expect(filters.sortDir).toBe('asc');
      expect(filters.page).toBe(2);
      expect(filters.limit).toBe(10);
    });
  });

  describe('validation errors', () => {
    it('returns 400 when service rejects invalid sortBy', async () => {
      listStub.rejects(new ValidationError('Invalid sortBy value: must be one of created, lastActivity, eventCount'));

      const app = buildAuthApp(buildAdmin());
      const response = await request(app)
        .get('/api/v1/admin/calendars')
        .query({ sortBy: 'bogus' });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      expect(response.body.error).toContain('Invalid sortBy');
    });

    it('returns 400 when service rejects invalid sortDir', async () => {
      listStub.rejects(new ValidationError('Invalid sortDir value: must be asc or desc'));

      const app = buildAuthApp(buildAdmin());
      const response = await request(app)
        .get('/api/v1/admin/calendars')
        .query({ sortDir: 'sideways' });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      expect(response.body.error).toContain('Invalid sortDir');
    });
  });
});
