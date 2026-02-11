import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import ModerationInterface from '@/server/moderation/interface';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Route handler for moderation analytics.
 *
 * Provides endpoints for instance administrators to retrieve
 * aggregated moderation metrics and trends.
 */
export default class AnalyticsRoutes {
  private moderationInterface: ModerationInterface;

  constructor(moderationInterface: ModerationInterface) {
    this.moderationInterface = moderationInterface;
  }

  /**
   * Registers route handlers on the given Express application.
   *
   * @param app - Express application instance
   * @param routePrefix - URL prefix for all routes (e.g. '/api/v1')
   */
  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    router.get(
      '/admin/moderation/analytics',
      ...ExpressHelper.adminOnly,
      this.getAnalytics.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * Retrieves comprehensive moderation analytics for a date range.
   * Combines data from multiple analytics service methods.
   *
   * GET /api/v1/admin/moderation/analytics
   */
  async getAnalytics(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Authentication required',
        errorName: 'ForbiddenError',
      });
      return;
    }

    if (!account.hasRole('admin')) {
      res.status(403).json({
        error: 'Admin access required',
        errorName: 'ForbiddenError',
      });
      return;
    }

    const { startDate: startDateStr, endDate: endDateStr } = req.query;

    // Validate required parameters
    if (!startDateStr) {
      res.status(400).json({
        error: 'startDate query parameter is required',
        errorName: 'ValidationError',
      });
      return;
    }

    if (!endDateStr) {
      res.status(400).json({
        error: 'endDate query parameter is required',
        errorName: 'ValidationError',
      });
      return;
    }

    // Parse and validate dates
    const startDate = new Date(startDateStr as string);
    const endDate = new Date(endDateStr as string);

    if (isNaN(startDate.getTime())) {
      res.status(400).json({
        error: 'Invalid startDate format',
        errorName: 'ValidationError',
      });
      return;
    }

    if (isNaN(endDate.getTime())) {
      res.status(400).json({
        error: 'Invalid endDate format',
        errorName: 'ValidationError',
      });
      return;
    }

    if (endDate <= startDate) {
      res.status(400).json({
        error: 'endDate must be after startDate',
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      const analyticsService = this.moderationInterface.getAnalyticsService();

      // Gather all analytics data
      const [
        reportsByStatus,
        resolutionRate,
        averageResolutionTime,
        reportsTrend,
        topReportedEvents,
        reporterVolume,
      ] = await Promise.all([
        analyticsService.getTotalReportsByStatus(startDate, endDate),
        analyticsService.getResolutionRate(startDate, endDate),
        analyticsService.getAverageResolutionTime(startDate, endDate),
        analyticsService.getReportsTrend(startDate, endDate),
        analyticsService.getTopReportedEvents(startDate, endDate),
        analyticsService.getReporterVolume(startDate, endDate),
      ]);

      res.json({
        reportsByStatus,
        resolutionRate,
        averageResolutionTime,
        reportsTrend,
        topReportedEvents,
        reporterVolume,
      });
    }
    catch (error: any) {
      logError(error, 'Failed to retrieve moderation analytics');
      res.status(500).json({
        error: 'Failed to retrieve analytics',
      });
    }
  }
}
