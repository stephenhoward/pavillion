import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import db from '@/server/common/entity/db';
import { initI18Next } from '@/server/common/test/lib/i18next';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { DiskUsageSnapshotEntity } from '@/server/housekeeping/entity/disk-snapshot';
import { DiskUsageStats } from '@/server/housekeeping/service/disk-monitor';
import DiskSnapshotService, { BACKUP_PATH_STAT_KEY } from '@/server/housekeeping/service/disk-snapshot';
import AlertsService from '@/server/housekeeping/service/alerts';
import { DISK_ALERT_GUIDE_URL } from '@/server/housekeeping/model/disk-alert-guide-url';
import { DiskAlertLocale, LIKELIHOOD_WORDS, findLikelihoodWord, normalize } from '@/server/housekeeping/test/disk-alert-wording';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import { StoredEmail } from '@/server/email/transport/testing-transport';

initI18Next();

const THRESHOLDS = { warning: 80, critical: 90 };
const LOCALES: DiskAlertLocale[] = ['en', 'es', 'fr'];
const NOW = new Date('2026-11-20T00:00:00.000Z');

const LEVELS = [
  { level: 'warning', percentageUsed: 85, namespace: 'disk_warning_email' },
  { level: 'critical', percentageUsed: 95, namespace: 'disk_critical_email' },
] as const;

/** Backup-deletion and disable-backups advice, within one sentence, per locale. */
const BACKUP_ADVICE: Record<DiskAlertLocale, RegExp[]> = {
  en: [/\b(delete|remove)\b[^.]*\bbackup/, /\bdisabl\w*[^.]*\bbackup/],
  es: [/\b(elimin|borr)\w*[^.]*\bcopias? de seguridad/, /\b(deshabilit|desactiv)\w*[^.]*\bcopias? de seguridad/],
  fr: [/\bsupprim\w*[^.]*\bsauvegardes?/, /\bdésactiv\w*[^.]*\bsauvegardes?/],
};

function adminAddress(locale: DiskAlertLocale): string {
  return `disk-render-${locale}@example.test`;
}

function readLocale(locale: DiskAlertLocale, namespace: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(path.resolve(), 'src/server/locales', locale, `${namespace}.json`), 'utf8'));
}

function reading(percentageUsed: number): DiskUsageStats {
  const usedBytes = BigInt(Math.round(percentageUsed * 10_000_000));
  const totalBytes = BigInt(1_000_000_000);
  return { totalBytes, usedBytes, freeBytes: totalBytes - usedBytes, percentageUsed, path: '/backups' };
}

/**
 * The disk warning and critical emails rendered for real: the hourly reading
 * goes through AlertsService.processDiskReading, the real email classes and
 * templates, and the email domain's in-memory testing transport, at each level
 * for an administrator in each shipped language.
 */
describe('Disk alert emails, rendered', () => {
  const emailInterface = new EmailInterface();
  const snapshots = new DiskSnapshotService();
  let alerts: AlertsService;

  beforeAll(async () => {
    await db.sync({ force: true });

    const env = new TestEnvironment();
    const accounts = new AccountsInterface();
    for (const locale of LOCALES) {
      const admin = await env.createAdminAccount(adminAddress(locale), `disk-render-pw!${locale}`);
      await accounts.updateProfile(admin, null, locale);
    }

    alerts = new AlertsService(emailInterface, accounts, snapshots);
  });

  beforeEach(async () => {
    await DiskUsageSnapshotEntity.destroy({ where: {}, truncate: true });
    emailInterface.clearEmails();
  });

  async function alertFor(percentageUsed: number, locale: DiskAlertLocale): Promise<StoredEmail> {
    const usage = reading(percentageUsed);
    await snapshots.recordSnapshot(BACKUP_PATH_STAT_KEY, usage, NOW);
    await alerts.processDiskReading(usage, THRESHOLDS, NOW);

    const sent = emailInterface.findEmailsByRecipient(adminAddress(locale));
    expect(sent).toHaveLength(1);
    return sent[0];
  }

  const cases = LEVELS.flatMap(entry => LOCALES.map(locale => ({ ...entry, locale })));

  it.each(cases)('$level at $percentageUsed% renders fully in $locale', async ({ percentageUsed, namespace, locale }) => {
    const email = await alertFor(percentageUsed, locale);
    const html = email.html as string;
    const copy = readLocale(locale, namespace);
    const parts = { subject: email.subject, text: email.text, html };

    // Rendered, with no unresolved placeholder or raw key.
    for (const [part, content] of Object.entries(parts)) {
      expect(content, part).toBeTruthy();
      expect(content, part).not.toContain('{{');
      expect(content, part).not.toContain(`${namespace}.`);
      expect(content, part).not.toMatch(/\b(disk_scope|first_step|guide_link_text|action_expand_storage)\b/);
    }

    // Each language's own copy, not the English fallback.
    if (locale !== 'en') {
      expect(email.subject).not.toBe(readLocale('en', namespace).subject.replace('{{usagePercent}}', `${percentageUsed.toFixed(1)}`));
    }
    for (const body of [email.text, html]) {
      expect(normalize(body)).toContain(normalize(copy.disk_scope));
      expect(normalize(body)).toContain(normalize(copy.first_step));
      expect(normalize(body)).toContain(normalize(copy.action_expand_storage));
      expect(body).toContain('docker system df');
      expect(body).toContain(DISK_ALERT_GUIDE_URL);
      expect(body).toContain(`${percentageUsed.toFixed(1)}%`);
      expect(body).not.toContain('/backups');
      for (const advice of BACKUP_ADVICE[locale]) {
        expect(normalize(body)).not.toMatch(advice);
      }
    }

    // Expanding storage is the last piece of advice.
    expect(normalize(email.text).lastIndexOf(normalize(copy.action_expand_storage)))
      .toBeGreaterThan(normalize(email.text).indexOf(normalize(copy.first_step)));

    // One recipient, nobody copied.
    expect(email.to).toEqual([adminAddress(locale)]);
    expect(email.raw).not.toMatch(/^(cc|bcc):/im);

    // The guide is the only external reference; nothing remote is loaded.
    expect(html.match(/https?:\/\/[^\s"'<>]+/g)).toEqual([DISK_ALERT_GUIDE_URL]);
    for (const remote of ['src=', '<link', 'url(', '@import', '<img']) {
      expect(html.toLowerCase()).not.toContain(remote);
    }

    // No cause is ranked or implied likely.
    for (const [part, content] of Object.entries(parts)) {
      expect({ part, word: findLikelihoodWord(content, LIKELIHOOD_WORDS[locale]) }).toEqual({ part, word: null });
    }
  });
});
