import { DateTime } from 'luxon';
import { useTranslation } from 'i18next-vue';
import { ReportStatus, ReportCategory } from '@/common/model/report';

/**
 * Composable providing shared formatting helpers for moderation report views.
 *
 * Encapsulates status badge class resolution, translated label lookups
 * for statuses, categories, and reporter types, and date formatting.
 * Used by both reports-dashboard and report-detail components.
 */
export function useReportFormatting() {
  const { t } = useTranslation('system', {
    keyPrefix: 'moderation',
  });

  /**
   * Resolves the CSS class for a report status badge.
   *
   * @param status - The report status value
   * @returns CSS class name for the badge
   */
  const statusBadgeClass = (status: string): string => {
    const classMap: Record<string, string> = {
      [ReportStatus.SUBMITTED]: 'status-badge--submitted',
      [ReportStatus.UNDER_REVIEW]: 'status-badge--under-review',
      [ReportStatus.RESOLVED]: 'status-badge--resolved',
      [ReportStatus.DISMISSED]: 'status-badge--dismissed',
      [ReportStatus.ESCALATED]: 'status-badge--escalated',
    };
    return classMap[status] || '';
  };

  /**
   * Returns the translated label for a report status.
   *
   * @param status - The report status value
   * @returns Translated label string
   */
  const statusLabel = (status: string): string => {
    const labelMap: Record<string, string> = {
      [ReportStatus.SUBMITTED]: t('status.submitted'),
      [ReportStatus.UNDER_REVIEW]: t('status.under_review'),
      [ReportStatus.RESOLVED]: t('status.resolved'),
      [ReportStatus.DISMISSED]: t('status.dismissed'),
      [ReportStatus.ESCALATED]: t('status.escalated'),
    };
    return labelMap[status] || status;
  };

  /**
   * Returns the translated label for a report category.
   *
   * @param category - The report category value
   * @returns Translated label string
   */
  const categoryLabel = (category: string): string => {
    const labelMap: Record<string, string> = {
      [ReportCategory.SPAM]: t('category.spam'),
      [ReportCategory.INAPPROPRIATE]: t('category.inappropriate'),
      [ReportCategory.MISLEADING]: t('category.misleading'),
      [ReportCategory.HARASSMENT]: t('category.harassment'),
      [ReportCategory.OTHER]: t('category.other'),
    };
    return labelMap[category] || category;
  };

  /**
   * Returns the translated label for a reporter type.
   *
   * @param reporterType - The reporter type value
   * @returns Translated label string
   */
  const reporterTypeLabel = (reporterType: string): string => {
    const labelMap: Record<string, string> = {
      anonymous: t('reporter_type.anonymous'),
      authenticated: t('reporter_type.authenticated'),
      administrator: t('reporter_type.administrator'),
    };
    return labelMap[reporterType] || reporterType;
  };

  /**
   * Formats a date for display using locale-aware formatting.
   *
   * @param date - Date or ISO string to format
   * @param style - Luxon format preset to use
   * @returns Formatted date string
   */
  const formatDate = (date: Date | string, style: Intl.DateTimeFormatOptions = DateTime.DATE_MED): string => {
    const dt = date instanceof Date ? DateTime.fromJSDate(date) : DateTime.fromISO(date as string);
    return dt.toLocaleString(style);
  };

  return {
    statusBadgeClass,
    statusLabel,
    categoryLabel,
    reporterTypeLabel,
    formatDate,
  };
}
