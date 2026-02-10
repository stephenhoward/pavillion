import { EventEmitter } from 'events';
import { logError } from '@/server/common/helper/error-logger';
import ModerationService from './moderation';
import type { ModerationSettings } from './moderation';
import { ReportEntity } from '@/server/moderation/entity/report';
import { ReportEscalationEntity } from '@/server/moderation/entity/report_escalation';
import { ReportStatus } from '@/common/model/report';
import { Op } from 'sequelize';

/** Default check interval: 15 minutes in milliseconds. */
const DEFAULT_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Scheduler service that periodically checks for reports approaching
 * or past their escalation deadlines.
 *
 * Handles three scenarios:
 * 1. Auto-escalation: reports past autoEscalationHours that need escalation to admin
 * 2. Admin re-escalation: admin-initiated reports past adminReportEscalationHours
 * 3. Reminders: reports approaching escalation deadline within reminderBeforeEscalationHours
 */
class EscalationScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly checkIntervalMs: number;
  private readonly moderationService: ModerationService;
  private readonly eventBus?: EventEmitter;

  constructor(
    moderationService: ModerationService,
    eventBus?: EventEmitter,
    checkIntervalMs: number = DEFAULT_CHECK_INTERVAL_MS,
  ) {
    this.moderationService = moderationService;
    this.eventBus = eventBus;
    this.checkIntervalMs = checkIntervalMs;
  }

  /**
   * Starts the periodic escalation check.
   * If already running, stops the existing interval first.
   */
  start(): void {
    if (this.intervalId) {
      this.stop();
    }
    this.intervalId = setInterval(() => {
      this.checkAndEscalate().catch((error) => {
        logError(error, '[MODERATION] Escalation scheduler check failed');
      });
    }, this.checkIntervalMs);
  }

  /**
   * Stops the periodic escalation check and clears the interval.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Returns whether the scheduler is currently running.
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Main check logic that runs on each interval tick.
   *
   * 1. Fetches moderation settings
   * 2. Auto-escalates overdue reports
   * 3. Re-escalates overdue admin-initiated reports
   * 4. Sends reminders for reports approaching deadline
   */
  async checkAndEscalate(): Promise<void> {
    let settings: ModerationSettings;
    try {
      settings = await this.moderationService.getModerationSettings();
    }
    catch (error) {
      logError(error, '[MODERATION] Failed to fetch moderation settings for escalation check');
      return;
    }

    // 1. Auto-escalate reports past the deadline
    await this.processAutoEscalations(settings.autoEscalationHours);

    // 2. Re-escalate admin-initiated reports past their deadline
    await this.processAdminReEscalations(settings.adminReportEscalationHours);

    // 3. Send reminders for reports approaching deadline
    await this.processReminders(settings.autoEscalationHours, settings.reminderBeforeEscalationHours);
  }

  /**
   * Finds and auto-escalates reports that have been in 'submitted' status
   * for longer than the configured autoEscalationHours.
   *
   * @param autoEscalationHours - Hours before auto-escalation triggers
   */
  private async processAutoEscalations(autoEscalationHours: number): Promise<void> {
    try {
      const reports = await this.getReportsNeedingAutoEscalation(autoEscalationHours);

      for (const reportEntity of reports) {
        try {
          await this.autoEscalateReport(reportEntity);
        }
        catch (error) {
          logError(error, `[MODERATION] Failed to auto-escalate report ${reportEntity.id}`);
        }
      }
    }
    catch (error) {
      logError(error, '[MODERATION] Failed to query reports needing auto-escalation');
    }
  }

  /**
   * Finds and re-escalates admin-initiated reports that have been in 'submitted'
   * status for longer than the configured adminReportEscalationHours.
   *
   * @param adminReportEscalationHours - Hours before admin report re-escalation triggers
   */
  private async processAdminReEscalations(adminReportEscalationHours: number): Promise<void> {
    try {
      const reports = await this.getAdminReportsNeedingReEscalation(adminReportEscalationHours);

      for (const reportEntity of reports) {
        try {
          await this.autoEscalateReport(reportEntity, true);
        }
        catch (error) {
          logError(error, `[MODERATION] Failed to re-escalate admin report ${reportEntity.id}`);
        }
      }
    }
    catch (error) {
      logError(error, '[MODERATION] Failed to query admin reports needing re-escalation');
    }
  }

  /**
   * Finds reports that are in the reminder window (approaching escalation deadline)
   * and emits reminder events for those that haven't had a reminder sent yet.
   *
   * @param autoEscalationHours - Hours before auto-escalation triggers
   * @param reminderBeforeHours - Hours before escalation to send reminder
   */
  private async processReminders(autoEscalationHours: number, reminderBeforeHours: number): Promise<void> {
    try {
      const reports = await this.getReportsNeedingReminder(autoEscalationHours, reminderBeforeHours);

      for (const reportEntity of reports) {
        try {
          await this.sendReminder(reportEntity);
        }
        catch (error) {
          logError(error, `[MODERATION] Failed to send reminder for report ${reportEntity.id}`);
        }
      }
    }
    catch (error) {
      logError(error, '[MODERATION] Failed to query reports needing reminders');
    }
  }

  /**
   * Queries for reports needing auto-escalation.
   *
   * Criteria:
   * - Status is 'submitted'
   * - Reporter type is NOT 'administrator' (those have their own escalation path)
   * - Created more than autoEscalationHours ago
   * - escalation_type is NULL (not already escalated)
   *
   * @param autoEscalationHours - Hours threshold for auto-escalation
   * @returns Array of report entities needing escalation
   */
  async getReportsNeedingAutoEscalation(autoEscalationHours: number): Promise<ReportEntity[]> {
    const deadline = new Date(Date.now() - autoEscalationHours * 60 * 60 * 1000);

    return ReportEntity.findAll({
      where: {
        status: ReportStatus.SUBMITTED,
        reporter_type: { [Op.ne]: 'administrator' },
        created_at: { [Op.lt]: deadline },
        escalation_type: null,
      },
    });
  }

  /**
   * Queries for admin-initiated reports needing re-escalation.
   *
   * Criteria:
   * - Status is 'submitted'
   * - Reporter type IS 'administrator'
   * - Created more than adminReportEscalationHours ago
   *
   * @param adminReportEscalationHours - Hours threshold for admin report re-escalation
   * @returns Array of report entities needing re-escalation
   */
  async getAdminReportsNeedingReEscalation(adminReportEscalationHours: number): Promise<ReportEntity[]> {
    const deadline = new Date(Date.now() - adminReportEscalationHours * 60 * 60 * 1000);

    return ReportEntity.findAll({
      where: {
        status: ReportStatus.SUBMITTED,
        reporter_type: 'administrator',
        created_at: { [Op.lt]: deadline },
      },
    });
  }

  /**
   * Queries for reports that are in the reminder window.
   *
   * A report needs a reminder when:
   * - Status is 'submitted'
   * - Reporter type is NOT 'administrator'
   * - Created between (autoEscalationHours - reminderBeforeHours) ago and autoEscalationHours ago
   * - No reminder has been sent yet (no escalation record with decision='reminder_sent')
   *
   * @param autoEscalationHours - Hours before auto-escalation triggers
   * @param reminderBeforeHours - Hours before escalation to send reminder
   * @returns Array of report entities needing a reminder
   */
  async getReportsNeedingReminder(autoEscalationHours: number, reminderBeforeHours: number): Promise<ReportEntity[]> {
    const escalationDeadline = new Date(Date.now() - autoEscalationHours * 60 * 60 * 1000);
    const reminderWindowStart = new Date(Date.now() - (autoEscalationHours - reminderBeforeHours) * 60 * 60 * 1000);

    // Find reports in the reminder window
    const candidates = await ReportEntity.findAll({
      where: {
        status: ReportStatus.SUBMITTED,
        reporter_type: { [Op.ne]: 'administrator' },
        escalation_type: null,
        created_at: {
          [Op.lt]: reminderWindowStart,
          [Op.gte]: escalationDeadline,
        },
      },
    });

    // Filter out reports that already had a reminder sent
    const results: ReportEntity[] = [];
    for (const report of candidates) {
      const reminderExists = await ReportEscalationEntity.findOne({
        where: {
          report_id: report.id,
          decision: 'reminder_sent',
        },
      });
      if (!reminderExists) {
        results.push(report);
      }
    }

    return results;
  }

  /**
   * Auto-escalates a single report by updating its status and creating
   * an escalation audit record.
   *
   * @param reportEntity - The report entity to escalate
   * @param isAdminReEscalation - Whether this is an admin report re-escalation
   */
  private async autoEscalateReport(reportEntity: ReportEntity, isAdminReEscalation: boolean = false): Promise<void> {
    const fromStatus = reportEntity.status;

    await reportEntity.update({
      status: ReportStatus.ESCALATED,
      escalation_type: 'automatic',
    });

    const notes = isAdminReEscalation
      ? 'Admin-initiated report auto-escalated due to inactivity by calendar owner'
      : 'Auto-escalated due to inactivity';

    const escalationRecord = ReportEscalationEntity.fromModel({
      reportId: reportEntity.id,
      fromStatus,
      toStatus: ReportStatus.ESCALATED,
      reviewerId: null,
      reviewerRole: 'system',
      decision: 'auto_escalation',
      notes,
    });
    await escalationRecord.save();

    const report = reportEntity.toModel();

    this.emit('report.auto_escalated', {
      report,
      reason: notes,
    });
  }

  /**
   * Records a reminder for a report and emits a reminder event.
   *
   * @param reportEntity - The report entity to send a reminder for
   */
  private async sendReminder(reportEntity: ReportEntity): Promise<void> {
    // Create an escalation record to track that a reminder was sent
    const reminderRecord = ReportEscalationEntity.fromModel({
      reportId: reportEntity.id,
      fromStatus: ReportStatus.SUBMITTED,
      toStatus: ReportStatus.SUBMITTED,
      reviewerId: null,
      reviewerRole: 'system',
      decision: 'reminder_sent',
      notes: 'Escalation reminder sent to calendar owner',
    });
    await reminderRecord.save();

    const report = reportEntity.toModel();

    this.emit('report.escalation_reminder', {
      report,
    });
  }

  /**
   * Emits a domain event on the event bus if available.
   *
   * @param event - Event name
   * @param payload - Event payload
   */
  private emit(event: string, payload: Record<string, any>): void {
    if (this.eventBus) {
      this.eventBus.emit(event, payload);
    }
  }
}

export default EscalationScheduler;
export { DEFAULT_CHECK_INTERVAL_MS };
