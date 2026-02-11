import axios from 'axios';
import { UnknownError } from '@/common/exceptions/base';

/**
 * Response structure from the analytics API endpoint.
 */
export interface AnalyticsData {
  reportsByStatus: Record<string, number>;
  resolutionRate: number;
  averageResolutionTime: number;
  reportsTrend: Array<{
    date: string;
    count: number;
  }>;
  topReportedEvents: Array<{
    eventId: string;
    reportCount: number;
  }>;
  reporterVolume: Record<string, number>;
}

/**
 * Service for fetching moderation analytics data.
 * Used by the admin analytics dashboard to retrieve
 * aggregated metrics and trends.
 */
export default class ModerationAnalyticsService {

  /**
   * Fetches comprehensive analytics data for a given date range.
   *
   * @param startDate - Start date in ISO format (YYYY-MM-DD)
   * @param endDate - End date in ISO format (YYYY-MM-DD)
   * @returns Analytics data including reports by status, resolution metrics, and trends
   * @throws {UnknownError} For server or network errors
   */
  async getAnalytics(startDate: string, endDate: string): Promise<AnalyticsData> {
    try {
      const response = await axios.get('/api/v1/admin/moderation/analytics', {
        params: {
          startDate,
          endDate,
        },
      });

      return response.data;
    }
    catch (error: unknown) {
      if (error && typeof error === 'object' && 'response' in error &&
          error.response && typeof error.response === 'object' && 'data' in error.response) {

        const responseData = error.response.data as Record<string, unknown>;
        const errorMessage = responseData.error as string;

        // Re-throw with more context if available
        throw new UnknownError(errorMessage || 'Failed to fetch analytics');
      }
      throw new UnknownError('Failed to fetch analytics');
    }
  }
}
