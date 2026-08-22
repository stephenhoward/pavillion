import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import HousekeepingInterface from '@/server/housekeeping/interface';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('housekeeping');

/**
 * Route handlers for housekeeping status API.
 *
 * Provides status information for the admin dashboard widget including
 * backup status, disk usage, and alert states.
 */
export default class HousekeepingStatusRoutes {
  private housekeepingInterface: HousekeepingInterface;

  constructor(housekeepingInterface: HousekeepingInterface) {
    this.housekeepingInterface = housekeepingInterface;
  }

  /**
   * Installs route handlers for housekeeping status endpoints.
   *
   * @param app - Express application instance
   * @param routePrefix - Route prefix (e.g., '/api/v1/admin/housekeeping')
   */
  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/status', ExpressHelper.adminOnly, this.getStatus.bind(this));
    app.use(routePrefix, router);
  }

  /**
   * Gets housekeeping system status for admin dashboard.
   *
   * Delegates to {@link HousekeepingInterface.getStatus}, which assembles
   * last/next backup info, disk usage, alert states, and retention stats.
   *
   * @param req - Express request
   * @param res - Express response
   */
  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const status = await this.housekeepingInterface.getStatus();
      res.json(status);
    }
    catch (error) {
      logger.error({ err: error }, 'Error getting housekeeping status');
      res.status(500).json({ error: 'Failed to get housekeeping status' });
    }
  }
}
