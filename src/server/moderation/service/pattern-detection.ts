import { Op } from 'sequelize';

import { ReportEntity } from '@/server/moderation/entity/report';

/**
 * Pattern type identifiers for abuse detection.
 */
type PatternType = 'source_flooding' | 'event_targeting' | 'instance_pattern';

/**
 * Severity levels for detected patterns.
 */
type PatternSeverity = 'low' | 'high';

/**
 * Structured result for pattern detection.
 */
interface PatternResult {
  type: PatternType;
  severity: PatternSeverity;
  count: number;
  threshold: number;
}

/**
 * Options for configuring pattern detection behavior.
 */
interface PatternDetectionOptions {
  timeWindowDays?: number;
  threshold?: number;
}

/**
 * Default time window for pattern detection in days.
 */
const DEFAULT_TIME_WINDOW_DAYS = 7;

/**
 * Default threshold for source flooding detection.
 */
const DEFAULT_SOURCE_FLOODING_THRESHOLD = 3;

/**
 * Default threshold for event targeting detection.
 */
const DEFAULT_EVENT_TARGETING_THRESHOLD = 3;

/**
 * Default threshold for instance pattern detection.
 */
const DEFAULT_INSTANCE_PATTERN_THRESHOLD = 5;

/**
 * Service for detecting abuse patterns in the moderation system.
 * Provides algorithms for detecting source flooding, event targeting,
 * and instance-level abuse patterns.
 */
class PatternDetectionService {

  /**
   * Detects if a report is part of a source flooding pattern.
   * Source flooding occurs when the same reporter (identified by email hash
   * or account ID) submits multiple reports targeting different events.
   *
   * @param reportId - ID of the report to analyze
   * @param options - Optional configuration for detection behavior
   * @returns Pattern result if pattern detected, null if report not found or no pattern
   */
  async detectSourceFlooding(
    reportId: string,
    options: PatternDetectionOptions = {},
  ): Promise<PatternResult | null> {
    const timeWindowDays = options.timeWindowDays ?? DEFAULT_TIME_WINDOW_DAYS;
    const threshold = options.threshold ?? DEFAULT_SOURCE_FLOODING_THRESHOLD;

    // Find the source report
    const sourceReport = await ReportEntity.findByPk(reportId);
    if (!sourceReport) {
      return null;
    }

    // Determine reporter identifier (email hash or account ID)
    const reporterEmailHash = sourceReport.reporter_email_hash;
    const reporterAccountId = sourceReport.reporter_account_id;

    // Cannot detect pattern without identifier
    if (!reporterEmailHash && !reporterAccountId) {
      return null;
    }

    // Calculate time window cutoff
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - timeWindowDays);

    // Build query conditions for same source
    const sourceConditions: any[] = [];
    if (reporterEmailHash) {
      sourceConditions.push({ reporter_email_hash: reporterEmailHash });
    }
    if (reporterAccountId) {
      sourceConditions.push({ reporter_account_id: reporterAccountId });
    }

    // Count reports from same source in time window
    const count = await ReportEntity.count({
      where: {
        [Op.or]: sourceConditions,
        created_at: {
          [Op.gte]: cutoffDate,
        },
      },
    });

    return {
      type: 'source_flooding',
      severity: count >= threshold ? 'high' : 'low',
      count,
      threshold,
    };
  }

  /**
   * Detects if an event is being targeted by multiple reports.
   * Event targeting occurs when multiple different sources submit
   * reports about the same event.
   *
   * @param eventId - ID of the event to analyze
   * @param options - Optional configuration for detection behavior
   * @returns Pattern result with targeting metrics
   */
  async detectEventTargeting(
    eventId: string,
    options: PatternDetectionOptions = {},
  ): Promise<PatternResult> {
    const timeWindowDays = options.timeWindowDays ?? DEFAULT_TIME_WINDOW_DAYS;
    const threshold = options.threshold ?? DEFAULT_EVENT_TARGETING_THRESHOLD;

    // Calculate time window cutoff
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - timeWindowDays);

    // Count reports targeting this event in time window
    const count = await ReportEntity.count({
      where: {
        event_id: eventId,
        created_at: {
          [Op.gte]: cutoffDate,
        },
      },
    });

    return {
      type: 'event_targeting',
      severity: count >= threshold ? 'high' : 'low',
      count,
      threshold,
    };
  }

  /**
   * Detects elevated report volume from a specific federated instance.
   * Instance patterns occur when an unusual number of reports originate
   * from the same federated instance.
   *
   * @param instanceUrl - URL of the federated instance to analyze
   * @param options - Optional configuration for detection behavior
   * @returns Pattern result with instance metrics
   */
  async detectInstancePatterns(
    instanceUrl: string,
    options: PatternDetectionOptions = {},
  ): Promise<PatternResult> {
    const timeWindowDays = options.timeWindowDays ?? DEFAULT_TIME_WINDOW_DAYS;
    const threshold = options.threshold ?? DEFAULT_INSTANCE_PATTERN_THRESHOLD;

    // Calculate time window cutoff
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - timeWindowDays);

    // Count reports from this instance in time window
    const count = await ReportEntity.count({
      where: {
        forwarded_from_instance: instanceUrl,
        created_at: {
          [Op.gte]: cutoffDate,
        },
      },
    });

    return {
      type: 'instance_pattern',
      severity: count >= threshold ? 'high' : 'low',
      count,
      threshold,
    };
  }
}

export { PatternDetectionService };
export type { PatternResult, PatternType, PatternSeverity, PatternDetectionOptions };
