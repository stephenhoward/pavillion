import express, { Request, Response } from 'express';
import { Server } from 'http';
import path from "path";
import helmet from 'helmet';
import handlebars from 'handlebars';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import { EventEmitter } from 'events';

import db, { seedDB, seedFollowData } from '@/server/common/entity/db';
import { runMigrations } from '@/server/common/migrations/runner';
import { router as indexRoutes } from '@/server/app_routes';
import { validateProductionSecrets } from '@/server/common/helper/production-validation';
import AccountsDomain from '@/server/accounts';
import ActivityPubDomain from './activitypub';
import AuthenticationDomain from './authentication';
import CalendarDomain from '@/server/calendar';
import ConfigurationDomain from './configuration';
import EmailDomain from './email';
import HousekeepingDomain from './housekeeping';
import ModerationDomain from './moderation';
import PublicCalendarDomain from './public';
import MediaDomain from './media';
import SetupDomain from './setup';
import SubscriptionDomain from './subscription';
import { createSetupModeMiddleware } from './setup/middleware/setup-mode';
import { createLocaleMiddleware } from '@/server/common/middleware/locale';
import { backfillUserActors } from '@/server/activitypub/scripts/backfill-user-actors';
import { backfillCalendarActors } from '@/server/activitypub/scripts/backfill-calendar-actors';
import { globalErrorHandler } from '@/server/common/middleware/error-handler';
import { localeMiddleware } from '@/server/common/middleware/locale';
import { createI18nConfig } from '@/common/i18n/config';

/**
 * Validates production environment configuration.
 *
 * In production mode (NODE_ENV=production), verifies that all required
 * secrets have been properly configured and are not using development defaults.
 *
 * @throws Error if production configuration is invalid
 */
function validateProductionEnvironment(): void {
  if (process.env.NODE_ENV === 'production') {
    console.log('Production mode: Validating secrets configuration...');
    validateProductionSecrets();
    console.log('Secrets validation passed.');
  }
}

/**
 * Initializes the database based on environment.
 *
 * In development mode: Uses db.sync({force: true}) to reset and re-seed the database.
 *   - Set DB_RESET=false to preserve data between restarts (useful for containerized development)
 * In production mode: Runs pending database migrations using umzug.
 *
 * @returns Promise that resolves when database is ready
 */
async function initializeDatabase(): Promise<void> {
  // Development, test, e2e, and federation environments use sync; production uses migrations
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'e2e' || process.env.NODE_ENV === 'federation') {
    // Check if database reset is disabled (for containerized development with persistent data)
    const skipReset = process.env.DB_RESET === 'false';

    if (skipReset) {
      // Sync schema without dropping tables (creates missing tables, preserves data)
      console.log('Development mode: Syncing database schema (preserving existing data)...');
      await db.sync({ force: false });
      console.log('Database schema synced (data preserved).');
    }
    else if (process.env.NODE_ENV === 'test') {
      // Test mode: sync database schema without seeding
      // This creates all tables defined by registered entities (including new ones like blocked_reporter)
      console.log('Test mode: Syncing database schema without seeding...');
      try {
        await db.sync({ force: true });
        console.log('Test database schema synced successfully.');
      }
      catch (error: any) {
        // In test mode, if sync fails due to existing indexes/tables (SQLite race condition),
        // the database is already initialized from a previous test run - skip sync
        if (error.parent?.code === 'SQLITE_ERROR' && error.message.includes('already exists')) {
          console.log('Database already initialized, skipping sync...');
        }
        else {
          throw error;
        }
      }
    }
    else {
      // Default development/federation/e2e behavior: reset and re-seed database
      let envLabel = 'Development';
      if (process.env.NODE_ENV === 'federation') envLabel = 'Federation';
      if (process.env.NODE_ENV === 'e2e') envLabel = 'E2E';

      console.log(`${envLabel} mode: Syncing database schema...`);
      await db.sync({ force: true });
      await seedDB();
      console.log('Database synced and seeded successfully.');

      // Backfill UserActors and CalendarActors for seeded accounts/calendars
      await backfillUserActors(undefined, false);
      console.log('User actors backfilled successfully.');
      await backfillCalendarActors(undefined, false);
      console.log('Calendar actors backfilled successfully.');

      // Seed follow relationships and category mappings (needs actor IDs from backfill)
      await seedFollowData();
      console.log('Follow data seeded successfully.');
    }
  }
  else {
    // Production mode: run migrations
    console.log('Production mode: Running database migrations...');
    const migrationsPath = path.join(process.cwd(), 'migrations');
    const result = await runMigrations(db, migrationsPath);

    if (!result.success) {
      console.error('Migration failed:', result.error?.message);
      throw new Error(`Database migration failed: ${result.error?.message}`);
    }

    if (result.executed.length > 0) {
      console.log(`Successfully executed ${result.executed.length} migration(s): ${result.executed.join(', ')}`);
    }
    else {
      console.log('No pending migrations to run.');
    }
  }
}

/**
 * Checks database connectivity for health check endpoint.
 *
 * @returns Promise that resolves to true if database is accessible, false otherwise
 */
async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await db.authenticate();
    return true;
  }
  catch {
    return false;
  }
}

/**
 * Sets up the health check endpoint for container orchestration.
 * This endpoint is used by Docker/Kubernetes to determine if the application is ready.
 *
 * @param app - Express application instance
 */
function setupHealthCheck(app: express.Application): void {
  app.get('/health', async (_req: Request, res: Response) => {
    const dbHealthy = await checkDatabaseHealth();

    const healthStatus = {
      status: dbHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbHealthy ? 'connected' : 'disconnected',
      },
    };

    if (dbHealthy) {
      res.status(200).json(healthStatus);
    }
    else {
      res.status(503).json(healthStatus);
    }
  });
}

/**
 * Initializes the Pavillion server with express application configuration.
 * Sets up view templates, internationalization, API routes and starts the server listener.
 *
 * @param {express.Application} app - The Express application instance to configure
 * @param {number} port - Port number to listen on
 * @returns {Promise<Server | null>} HTTP server instance for cleanup, or null in test mode
 */
const initPavillionServer = async (app: express.Application, port: number): Promise<Server | null> => {

  // Validate production environment configuration before starting
  validateProductionEnvironment();

  // Configure Express to trust proxy headers for accurate client IP detection
  // This is essential for rate limiting behind reverse proxies like nginx
  app.set('trust proxy', 1);

  // Set up health check endpoint first (before other routes and middleware)
  setupHealthCheck(app);

  // Add comprehensive security headers middleware using helmet
  // Provides protection against clickjacking, MIME sniffing, XSS, and other vulnerabilities
  app.use(helmet({
    // Production-only HSTS: only enable in production with HTTPS to avoid locking out local development
    hsts: process.env.NODE_ENV === 'production' ? {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: false, // Don't preload by default
    } : false,
    // Explicit referrer policy: balanced approach - full URL to same origin, only origin to cross-origin
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },
    // Dual-header clickjacking protection for maximum browser compatibility
    frameguard: {
      action: 'deny', // Default deny for all routes (widget routes will override)
    },
    // Disable helmet's CSP - we'll set frame-ancestors manually below
    contentSecurityPolicy: false,
  }));

  // Set frame-ancestors CSP header manually for clickjacking protection
  // This works alongside X-Frame-Options for dual-header defense
  app.use((req, res, next) => {
    // Only set if not already set by route-specific middleware (e.g., widget routes)
    const existingCSP = res.getHeader('Content-Security-Policy');
    if (!existingCSP) {
      res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    }
    next();
  });

  // Resolve req.locale for every request using the detection chain:
  // URL prefix → account language → cookie → Accept-Language → instance default → 'en'
  app.use(localeMiddleware);

  app.set("views", path.join(path.resolve(), "src/server/templates"));
  // Initialize i18next with shared base config plus server-specific backend plugin
  i18next.use(Backend).init(createI18nConfig({
    initAsync: false,
    backend: {
      loadPath: path.join(path.resolve(), "src/server/locales/{{lng}}/{{ns}}.json"),
    },
  }));

  // Add a global translation helper to Handlebars
  handlebars.registerHelper('t', function(key: string, options: any) {
    const lng = options.data.root.language || 'en';
    return i18next.t(key, { lng, ...options.hash });
  });

  // Serve static assets in production or e2e mode from the Vite build output
  // E2E mode needs built assets since Vite dev server isn't running
  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "e2e") {
    const distPath = path.join(path.resolve(), "dist");
    app.use("/assets", express.static(path.join(distPath, "assets")));
  }

  const eventBus = new EventEmitter();

  // Initialize Setup domain first (needed for setup mode middleware)
  const setupDomain = new SetupDomain();
  setupDomain.initialize(app);

  // Add setup mode middleware early in the pipeline (before authentication)
  // This middleware blocks all routes except /setup when no admin exists
  app.use(createSetupModeMiddleware(setupDomain.interface));

  app.use('/', indexRoutes);

  const configurationDomain = new ConfigurationDomain(eventBus);
  configurationDomain.initialize(app);

  // Add locale middleware after configuration domain is initialized so it can
  // use the ConfigurationInterface to read instance language settings.
  // This respects domain-driven design boundaries by going through the interface.
  app.use(createLocaleMiddleware(configurationDomain.interface));

  // Initialize Email domain (no API routes, provides interface for cross-domain email sending)
  const emailDomain = new EmailDomain();

  const accountsDomain = new AccountsDomain(eventBus, configurationDomain.interface, setupDomain.interface, emailDomain.interface);
  accountsDomain.initialize(app);

  const authenticationDomain = new AuthenticationDomain(eventBus, accountsDomain.interface, emailDomain.interface);
  authenticationDomain.initialize(app);

  // Initialize subscription domain before calendar domain (calendar needs subscription interface)
  const subscriptionDomain = new SubscriptionDomain(eventBus);
  subscriptionDomain.initialize(app);

  const calendarDomain = new CalendarDomain(eventBus, accountsDomain.interface, emailDomain.interface, subscriptionDomain.interface);
  calendarDomain.initialize(app);

  // Initialize moderation domain before ActivityPub (ActivityPub inbox needs ModerationInterface)
  const moderationDomain = new ModerationDomain(eventBus, calendarDomain.interface, accountsDomain.interface, emailDomain.interface, configurationDomain.interface);
  moderationDomain.initialize(app);

  // Initialize ActivityPub domain with ModerationInterface for instance blocking
  new ActivityPubDomain(eventBus, calendarDomain.interface, accountsDomain.interface, moderationDomain.interface).initialize(app);

  // Set up CalendarInterface on AccountsInterface to enable calendar editor invitation acceptance
  // TODO: move invites into a separate domain to avoid circular dependency
  accountsDomain.interface.setCalendarInterface(calendarDomain.interface);

  new PublicCalendarDomain(eventBus,calendarDomain).initialize(app);

  new MediaDomain(eventBus,calendarDomain.interface).initialize(app);

  // Initialize housekeeping domain (for automated server maintenance)
  const housekeepingDomain = new HousekeepingDomain(eventBus, emailDomain.interface, accountsDomain.interface);
  housekeepingDomain.initialize(app);

  // Register global error handler (MUST be after all routes and middleware)
  app.use(globalErrorHandler);

  // Initialize database before starting the server
  try {
    await initializeDatabase();

    // Refresh event instances after database is ready (only in development and e2e)
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'e2e') {
      await calendarDomain.interface.refreshAllEventInstances();
    }

    // In test mode, supertest works directly with the Express app object
    // without needing the server to actually listen on a port
    if (process.env.NODE_ENV !== 'test') {
      const server = app.listen(port, () => {
        console.log(`Pavillion listening at http://localhost:${port}/`);
      });

      // Add graceful shutdown handlers for clean server termination
      if (process.env.NODE_ENV === 'e2e') {
        // Lightweight shutdown for e2e: close server and exit immediately
        // The test helper sends SIGTERM and waits 5s before SIGKILL
        const shutdownE2e = () => {
          server.close(() => process.exit(0));
          setTimeout(() => process.exit(0), 2000).unref();
        };
        process.on('SIGTERM', shutdownE2e);
        process.on('SIGINT', shutdownE2e);
      }
      else if (process.env.NODE_ENV !== 'test') {
        const gracefulShutdown = async (signal: string) => {
          console.log(`${signal} received. Starting graceful shutdown...`);

          try {
            // Close database connections first
            await db.close();
            console.log('Database connection closed.');

            // Then close the HTTP server
            server.close(() => {
              console.log('HTTP server closed.');
              process.exit(0);
            });

            // Force exit if server.close() doesn't complete quickly (10 seconds)
            setTimeout(() => {
              console.log('Server close timeout - forcing exit');
              process.exit(0);
            }, 10000).unref();
          }
          catch (error) {
            console.error('Error during shutdown:', error);
            process.exit(1);
          }
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
      }

      return server;
    }

    return null;
  }
  catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
};

export default initPavillionServer;
export { checkDatabaseHealth, setupHealthCheck, validateProductionEnvironment };
