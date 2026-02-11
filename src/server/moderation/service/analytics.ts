import { Op, fn, col, literal } from 'sequelize';
import { DateTime } from 'luxon';

import { ReportEntity } from '@/server/moderation/entity/report';
import { ReportStatus } from '@/common/model/report';
import type { ReporterType } from '@/common/model/report';

/**
 * Response type for getTotalReportsByStatus.
 */
interface ReportsByStatusResult {
  [status: string]: number;
}

/**
 * Response type for getResolutionRate.
 */
interface ResolutionRateResult {
  ownerResolutionRate: number;
  escalationRate: number;
  totalReports: number;
  ownerResolved: number;
  escalated: number;
}

/**
 * Response type for getAverageResolutionTime.
 */
interface AverageResolutionTimeResult {
  anonymous: number;
  authenticated: number;
  administrator: number;
  federation: number;
  overall: number;
}

/**
 * Response type for getReportsTrend.
 */
interface ReportsTrendResult {
  date: string;
  count: number;
}

/**
 * Response type for getTopReportedEvents.
 */
interface TopReportedEvent {
  eventId: string;
  reportCount: number;
}

/**
 * Response type for getReporterVolume.
 */
interface ReporterVolumeResult {
  anonymous: number;
  authenticated: number;
  administrator: number;
  federation: number;
}

/**
 * Service for calculating moderation analytics metrics.
 * Provides aggregated data about reports, resolution rates, and trends.
 */
class AnalyticsService {

  /**
   * Gets total reports grouped by status within a date range.
   *
   * @param startDate - Start of date range
   * @param endDate - End of date range
   * @returns Object with status as keys and counts as values
   */
  async getTotalReportsByStatus(
    startDate: Date,
    endDate: Date,
  ): Promise<ReportsByStatusResult> {
    const results = await ReportEntity.findAll({
      attributes: [
        'status',
        [fn('COUNT', col('id')), 'count'],
      ],
      where: {
        created_at: {
          [Op.between]: [startDate, endDate],
        },
      },
      group: ['status'],
      raw: true,
    });

    const resultMap: ReportsByStatusResult = {};
    for (const row of results as any[]) {
      resultMap[row.status] = parseInt(row.count, 10);
    }

    return resultMap;
  }

  /**
   * Calculates resolution rate showing owner-level vs escalated resolution.
   *
   * Resolution logic:
   * - Reports resolved/dismissed without escalation are owner-resolved
   * - Reports with escalation_type set are escalated
   * - Pending reports are excluded from rate calculation
   *
   * @param startDate - Start of date range
   * @param endDate - End of date range
   * @returns Resolution metrics including rates and counts
   */
  async getResolutionRate(
    startDate: Date,
    endDate: Date,
  ): Promise<ResolutionRateResult> {
    const reports = await ReportEntity.findAll({
      where: {
        created_at: {
          [Op.between]: [startDate, endDate],
        },
      },
      raw: true,
    });

    const totalReports = reports.length;

    if (totalReports === 0) {
      return {
        ownerResolutionRate: 0,
        escalationRate: 0,
        totalReports: 0,
        ownerResolved: 0,
        escalated: 0,
      };
    }

    let ownerResolved = 0;
    let escalated = 0;

    for (const report of reports as any[]) {
      if (report.escalation_type !== null) {
        escalated++;
      }
      else if (
        report.status === ReportStatus.RESOLVED ||
        report.status === ReportStatus.DISMISSED
      ) {
        ownerResolved++;
      }
    }

    return {
      ownerResolutionRate: ownerResolved / totalReports,
      escalationRate: escalated / totalReports,
      totalReports,
      ownerResolved,
      escalated,
    };
  }

  /**
   * Calculates average time to resolution in hours, grouped by reporter type.
   * Only includes resolved or dismissed reports that have a reviewer_timestamp.
   *
   * @param startDate - Start of date range
   * @param endDate - End of date range
   * @returns Average resolution hours by reporter type and overall
   */
  async getAverageResolutionTime(
    startDate: Date,
    endDate: Date,
  ): Promise<AverageResolutionTimeResult> {
    const reports = await ReportEntity.findAll({
      where: {
        created_at: {
          [Op.between]: [startDate, endDate],
        },
        status: {
          [Op.in]: [ReportStatus.RESOLVED, ReportStatus.DISMISSED],
        },
        reviewer_timestamp: {
          [Op.not]: null,
        },
      },
      raw: true,
    });

    const reporterTypes: ReporterType[] = ['anonymous', 'authenticated', 'administrator', 'federation'];
    const timesByType: Record<string, number[]> = {
      anonymous: [],
      authenticated: [],
      administrator: [],
      federation: [],
    };

    for (const report of reports as any[]) {
      const createdAt = DateTime.fromJSDate(new Date(report.created_at));
      const resolvedAt = DateTime.fromJSDate(new Date(report.reviewer_timestamp));
      const hoursToResolve = resolvedAt.diff(createdAt, 'hours').hours;

      const reporterType = report.reporter_type as ReporterType;
      if (timesByType[reporterType]) {
        timesByType[reporterType].push(hoursToResolve);
      }
    }

    const result: AverageResolutionTimeResult = {
      anonymous: 0,
      authenticated: 0,
      administrator: 0,
      federation: 0,
      overall: 0,
    };

    let totalHours = 0;
    let totalCount = 0;

    for (const type of reporterTypes) {
      const times = timesByType[type];
      if (times.length > 0) {
        const average = times.reduce((sum, time) => sum + time, 0) / times.length;
        result[type] = Math.round(average);
        totalHours += times.reduce((sum, time) => sum + time, 0);
        totalCount += times.length;
      }
    }

    if (totalCount > 0) {
      result.overall = Math.round(totalHours / totalCount);
    }

    return result;
  }

  /**
   * Gets reports trend data over time, grouped by date.
   *
   * @param startDate - Start of date range
   * @param endDate - End of date range
   * @returns Array of date/count pairs
   */
  async getReportsTrend(
    startDate: Date,
    endDate: Date,
  ): Promise<ReportsTrendResult[]> {
    const results = await ReportEntity.findAll({
      attributes: [
        [fn('DATE', col('created_at')), 'date'],
        [fn('COUNT', col('id')), 'count'],
      ],
      where: {
        created_at: {
          [Op.between]: [startDate, endDate],
        },
      },
      group: [literal('DATE(created_at)')],
      order: [[literal('DATE(created_at)'), 'ASC']],
      raw: true,
    });

    return (results as any[]).map(row => ({
      date: row.date,
      count: parseInt(row.count, 10),
    }));
  }

  /**
   * Gets the most reported events within a date range.
   *
   * @param startDate - Start of date range
   * @param endDate - End of date range
   * @param limit - Maximum number of events to return
   * @returns Array of events with report counts, sorted by count descending
   */
  async getTopReportedEvents(
    startDate: Date,
    endDate: Date,
    limit: number = 10,
  ): Promise<TopReportedEvent[]> {
    const results = await ReportEntity.findAll({
      attributes: [
        'event_id',
        [fn('COUNT', col('id')), 'report_count'],
      ],
      where: {
        created_at: {
          [Op.between]: [startDate, endDate],
        },
      },
      group: ['event_id'],
      order: [[literal('COUNT(id)'), 'DESC']],
      limit,
      raw: true,
    });

    return (results as any[]).map(row => ({
      eventId: row.event_id,
      reportCount: parseInt(row.report_count, 10),
    }));
  }

  /**
   * Gets anonymized reporter volume counts by reporter type.
   * Counts unique reporters per type (using email_hash or account_id).
   *
   * @param startDate - Start of date range
   * @param endDate - End of date range
   * @returns Counts of unique reporters by type
   */
  async getReporterVolume(
    startDate: Date,
    endDate: Date,
  ): Promise<ReporterVolumeResult> {
    const results = await ReportEntity.findAll({
      attributes: [
        'reporter_type',
        [
          fn(
            'COUNT',
            fn(
              'DISTINCT',
              fn(
                'COALESCE',
                col('reporter_email_hash'),
                col('reporter_account_id'),
              ),
            ),
          ),
          'unique_reporters',
        ],
      ],
      where: {
        created_at: {
          [Op.between]: [startDate, endDate],
        },
      },
      group: ['reporter_type'],
      raw: true,
    });

    const result: ReporterVolumeResult = {
      anonymous: 0,
      authenticated: 0,
      administrator: 0,
      federation: 0,
    };

    for (const row of results as any[]) {
      const reporterType = row.reporter_type as ReporterType;
      const count = parseInt(row.unique_reporters, 10);
      if (result.hasOwnProperty(reporterType)) {
        result[reporterType] = count;
      }
    }

    return result;
  }
}

export default AnalyticsService;
