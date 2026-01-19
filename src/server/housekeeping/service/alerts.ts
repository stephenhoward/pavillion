import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import DiskWarningEmail from '@/server/housekeeping/model/disk-warning-email';
import DiskCriticalEmail from '@/server/housekeeping/model/disk-critical-email';

/**
 * Service for sending disk space alert emails.
 *
 * Handles sending warning and critical alerts to administrators when
 * disk usage exceeds configured thresholds. Sends emails to all admin
 * users in their preferred languages. Gracefully handles SMTP
 * configuration issues by logging errors without throwing.
 */
export default class AlertsService {
  private emailInterface: EmailInterface;
  private accountsInterface: AccountsInterface;

  /**
   * Creates an AlertsService instance.
   *
   * @param emailInterface - Email interface for sending notifications
   * @param accountsInterface - Accounts interface for querying admin users
   */
  constructor(emailInterface: EmailInterface, accountsInterface: AccountsInterface) {
    this.emailInterface = emailInterface;
    this.accountsInterface = accountsInterface;
  }

  /**
   * Sends a warning-level disk space alert to all admin users.
   *
   * Called when disk usage reaches the warning threshold (typically 80%).
   * Queries all admin accounts and sends each admin an email in their
   * preferred language.
   *
   * @param usagePercent - Current disk usage percentage
   * @param threshold - Warning threshold that was exceeded
   * @param path - Path being monitored (e.g., /backups)
   * @param usedSpace - Formatted used space string (e.g., "47.2 GB")
   * @param totalSpace - Formatted total space string (e.g., "100.0 GB")
   */
  async sendDiskWarning(
    usagePercent: number,
    threshold: number,
    path: string,
    usedSpace?: string,
    totalSpace?: string,
  ): Promise<void> {
    try {
      // Get all admin accounts
      const adminAccounts = await this.accountsInterface.getAdmins();

      if (adminAccounts.length === 0) {
        console.warn('[Alerts] No admin accounts found, skipping warning alert');
        return;
      }

      // Send email to each admin in their preferred language
      let sentCount = 0;
      for (const admin of adminAccounts) {
        try {
          const language = admin.language || 'en';
          const email = new DiskWarningEmail(
            usagePercent,
            threshold,
            path,
            usedSpace || `${usagePercent.toFixed(1)}%`,
            totalSpace || '100%',
            admin.email,
          );

          const mailData = email.buildMessage(language);
          await this.emailInterface.sendEmail(mailData);
          sentCount++;
        }
        catch (error: any) {
          console.warn(`[Alerts] Failed to send warning to ${admin.email}:`, error.message);
        }
      }

      console.log(`[Alerts] Warning emails sent to ${sentCount}/${adminAccounts.length} admins for ${usagePercent.toFixed(1)}% disk usage`);
    }
    catch (error: any) {
      // Gracefully handle email failures - log but don't throw
      // This allows monitoring to continue even if SMTP is not configured
      console.warn('[Alerts] Failed to send warning alert:', error.message);
    }
  }

  /**
   * Sends a critical-level disk space alert to all admin users.
   *
   * Called when disk usage reaches the critical threshold (typically 90%).
   * Queries all admin accounts and sends each admin an email in their
   * preferred language with urgent messaging.
   *
   * @param usagePercent - Current disk usage percentage
   * @param threshold - Critical threshold that was exceeded
   * @param path - Path being monitored (e.g., /backups)
   * @param usedSpace - Formatted used space string (e.g., "85.5 GB")
   * @param totalSpace - Formatted total space string (e.g., "100.0 GB")
   */
  async sendDiskCritical(
    usagePercent: number,
    threshold: number,
    path: string,
    usedSpace?: string,
    totalSpace?: string,
  ): Promise<void> {
    try {
      // Get all admin accounts
      const adminAccounts = await this.accountsInterface.getAdmins();

      if (adminAccounts.length === 0) {
        console.warn('[Alerts] No admin accounts found, skipping critical alert');
        return;
      }

      // Send email to each admin in their preferred language
      let sentCount = 0;
      for (const admin of adminAccounts) {
        try {
          const language = admin.language || 'en';
          const email = new DiskCriticalEmail(
            usagePercent,
            threshold,
            path,
            usedSpace || `${usagePercent.toFixed(1)}%`,
            totalSpace || '100%',
            admin.email,
          );

          const mailData = email.buildMessage(language);
          await this.emailInterface.sendEmail(mailData);
          sentCount++;
        }
        catch (error: any) {
          console.warn(`[Alerts] Failed to send critical alert to ${admin.email}:`, error.message);
        }
      }

      console.log(`[Alerts] CRITICAL emails sent to ${sentCount}/${adminAccounts.length} admins for ${usagePercent.toFixed(1)}% disk usage`);
    }
    catch (error: any) {
      // Gracefully handle email failures - log but don't throw
      // This allows monitoring to continue even if SMTP is not configured
      console.warn('[Alerts] Failed to send critical alert:', error.message);
    }
  }

}
