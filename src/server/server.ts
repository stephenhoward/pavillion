import express, { Request, Response } from 'express';
import path from "path";
import handlebars from 'handlebars';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import { EventEmitter } from 'events';

import db, { seedDB } from '@/server/common/entity/db';
import { runMigrations } from '@/server/common/migrations/runner';
import { router as indexRoutes } from '@/server/app_routes';
import { validateProductionSecrets } from '@/server/common/helper/production-validation';
import AccountsDomain from '@/server/accounts';
import ActivityPubDomain from './activitypub';
import AuthenticationDomain from './authentication';
import CalendarDomain from '@/server/calendar';
import ConfigurationDomain from './configuration';
import PublicCalendarDomain from './public';
import MediaDomain from './media';
import SetupDomain from './setup';
import SubscriptionDomain from './subscription';
import { createSetupModeMiddleware } from './setup/middleware/setup-mode';

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
  // Development and test environments use sync, production uses migrations
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    // Check if database reset is disabled (for containerized development with persistent data)
    const skipReset = process.env.DB_RESET === 'false';

    if (skipReset) {
      // Sync schema without dropping tables (creates missing tables, preserves data)
      console.log('Development mode: Syncing database schema (preserving existing data)...');
      await db.sync({ force: false });
      console.log('Database schema synced (data preserved).');
    }
    else if (process.env.NODE_ENV === 'test') {
      // Test mode: schema is managed by test environment, skip sync
      console.log('Test mode: Skipping database sync (managed by test environment).');
    }
    else {
      // Default development behavior: reset and re-seed database
      console.log('Development mode: Syncing database schema...');
      await db.sync({ force: true });
      await seedDB();
      console.log('Database synced and seeded successfully.');
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
 */
const initPavillionServer = async (app: express.Application, port: number) => {

  // Validate production environment configuration before starting
  validateProductionEnvironment();

  // Set up health check endpoint first (before other routes and middleware)
  setupHealthCheck(app);

  app.set("views", path.join(path.resolve(), "src/server/templates"));
  // Initialize i18next with default configuration
  i18next.use(Backend).init({
    fallbackLng: 'en',
    initAsync: false,
    backend: {
      loadPath: path.join(path.resolve(), "src/server/locales/{{lng}}/{{ns}}.json"),
    },
  });

  // Add a global translation helper to Handlebars
  handlebars.registerHelper('t', function(key: string, options: any) {
    const lng = options.data.root.language || 'en';
    return i18next.t(key, { lng, ...options.hash });
  });

  // Serve static assets in production from the Vite build output
  if (process.env.NODE_ENV === "production") {
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

  const accountsDomain = new AccountsDomain(eventBus, configurationDomain.interface, setupDomain.interface);
  accountsDomain.initialize(app);

  const authenticationDomain = new AuthenticationDomain(eventBus, accountsDomain.interface);
  authenticationDomain.initialize(app);

  new ActivityPubDomain(eventBus).initialize(app);

  const calendarDomain = new CalendarDomain(eventBus, accountsDomain.interface);
  calendarDomain.initialize(app);

  // Set up CalendarInterface on AccountsInterface to enable calendar editor invitation acceptance
  // TODO: move invites into a separate domain to avoid circular dependency
  accountsDomain.interface.setCalendarInterface(calendarDomain.interface);

  new PublicCalendarDomain(eventBus,calendarDomain).initialize(app);

  new MediaDomain(eventBus,calendarDomain.interface).initialize(app);

  // Initialize subscription domain (after accounts domain)
  const subscriptionDomain = new SubscriptionDomain(eventBus);
  subscriptionDomain.initialize(app);

  // Initialize database before starting the server
  try {
    await initializeDatabase();

    // Refresh event instances after database is ready (only in development)
    if (process.env.NODE_ENV === 'development') {
      await calendarDomain.interface.refreshAllEventInstances();
    }

    app.listen(port, () => {
      console.log(`Pavillion listening at http://localhost:${port}/`);
    });
  }
  catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
};

export default initPavillionServer;
export { checkDatabaseHealth, setupHealthCheck, validateProductionEnvironment };
