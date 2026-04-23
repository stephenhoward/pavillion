import { v4 as uuidv4 } from 'uuid';
import config from 'config';

import { Account } from '@/common/model/account';
import { ImportSource } from '@/common/model/import_source';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import { ImportSourceNotFoundError } from '@/common/exceptions/import';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';
import { validateUrlNotPrivate } from '@/server/common/helper/ip-validation';
import { createLogger } from '@/server/common/helper/logger';
import CalendarService from '@/server/calendar/service/calendar';
import { generateVerificationToken } from '@/server/calendar/service/import/hmac';

const logger = createLogger('calendar.import.source');

/** Default cap when config value is absent. */
const DEFAULT_MAX_SOURCES_PER_CALENDAR = 10;

/**
 * Service for managing per-calendar ICS import sources.
 *
 * Implements the CRUD surface described in pv-1qcp.1.4:
 *
 *  - `createSource`     — validate calendar ownership, SSRF-check the URL,
 *                         enforce the per-calendar source cap, persist a new
 *                         row with `verification_state='pending'` and a
 *                         freshly-derived HMAC verification token
 *  - `listSources`      — all sources for a calendar (editor-permission-gated)
 *  - `getSource`        — single source by id, scoped to the calendar
 *  - `deleteSource`     — hard delete; DB `ON DELETE CASCADE` removes
 *                         dependent import_run rows, and
 *                         `event.import_source_id` is nulled out by the
 *                         migration's `ON DELETE SET NULL` FK
 *
 * URL immutability: there is no `updateSource` / URL-mutation method by
 * design. Any change to the source URL requires delete + recreate, which
 * forces a fresh DNS verification (security-advisor).
 *
 * The service is entity-level — it does NOT surface the stored verification
 * token on returned models. The token is an owner-only secret surfaced once
 * by the dedicated verification-issue flow (pv-1qcp milestone B). Generic
 * list/read responses must never leak it.
 *
 * @see bead pv-1qcp.1.4
 */
class ImportSourceService {

  constructor(private calendarService?: CalendarService) {
    // calendarService is optional so callers in a future wiring pass can
    // inject the shared instance; when absent we fall back to loading the
    // calendar entity directly (mirrors WidgetConfigService).
  }

  /**
   * Create a new import source for a calendar.
   *
   * @param account - The requesting account (must own or edit the calendar)
   * @param calendarId - The calendar UUID
   * @param url - The ICS feed URL (HTTPS, non-private, SSRF-checked)
   * @returns The persisted ImportSource in `verification_state='pending'`
   * @throws CalendarNotFoundError if the calendar does not exist
   * @throws CalendarEditorPermissionError if the account lacks edit access
   * @throws ValidationError if the URL is empty, malformed, or fails SSRF checks,
   *                        or if the per-calendar cap would be exceeded
   */
  async createSource(account: Account, calendarId: string, url: string): Promise<ImportSource> {
    await this.assertEditorAccess(account, calendarId);

    const normalizedUrl = this.validateUrl(url);
    await this.assertUrlIsPublic(normalizedUrl);

    await this.assertUnderSourceCap(calendarId);
    await this.assertUrlNotDuplicate(calendarId, normalizedUrl);

    const id = uuidv4();
    const token = generateVerificationToken(id, calendarId);

    const entity = ImportSourceEntity.build({
      id,
      calendar_id: calendarId,
      url: normalizedUrl,
      enabled: true,
      verification_state: 'pending',
      verification_token: token,
    });
    await entity.save();

    logger.info(
      { calendarId, importSourceId: id },
      'Created import source (verification pending)',
    );

    return entity.toModel();
  }

  /**
   * List all import sources for a calendar.
   *
   * @param account - The requesting account (must own or edit the calendar)
   * @param calendarId - The calendar UUID
   * @returns Array of ImportSource models (verification token NOT included)
   * @throws CalendarNotFoundError if the calendar does not exist
   * @throws CalendarEditorPermissionError if the account lacks edit access
   */
  async listSources(account: Account, calendarId: string): Promise<ImportSource[]> {
    await this.assertEditorAccess(account, calendarId);

    const entities = await ImportSourceEntity.findAll({
      where: { calendar_id: calendarId },
      order: [['created_at', 'ASC']],
    });

    return entities.map(entity => entity.toModel());
  }

  /**
   * Get a single import source by id, scoped to the calendar.
   *
   * @param account - The requesting account (must own or edit the calendar)
   * @param calendarId - The calendar UUID
   * @param id - The import source UUID
   * @returns The matching ImportSource model
   * @throws CalendarNotFoundError if the calendar does not exist
   * @throws CalendarEditorPermissionError if the account lacks edit access
   * @throws ImportSourceNotFoundError if no matching source exists on the calendar
   */
  async getSource(account: Account, calendarId: string, id: string): Promise<ImportSource> {
    await this.assertEditorAccess(account, calendarId);

    const entity = await ImportSourceEntity.findOne({
      where: { id, calendar_id: calendarId },
    });

    if (!entity) {
      throw new ImportSourceNotFoundError();
    }

    return entity.toModel();
  }

  /**
   * Delete an import source. The DB migration handles cascade semantics:
   *  - `import_run.import_source_id` is `ON DELETE CASCADE`
   *  - `event.import_source_id` is `ON DELETE SET NULL`
   *
   * @param account - The requesting account (must own or edit the calendar)
   * @param calendarId - The calendar UUID
   * @param id - The import source UUID
   * @throws CalendarNotFoundError if the calendar does not exist
   * @throws CalendarEditorPermissionError if the account lacks edit access
   * @throws ImportSourceNotFoundError if no matching source exists on the calendar
   */
  async deleteSource(account: Account, calendarId: string, id: string): Promise<void> {
    await this.assertEditorAccess(account, calendarId);

    const entity = await ImportSourceEntity.findOne({
      where: { id, calendar_id: calendarId },
    });

    if (!entity) {
      throw new ImportSourceNotFoundError();
    }

    await entity.destroy();

    logger.info({ calendarId, importSourceId: id }, 'Deleted import source');
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  /**
   * Parse and normalize the URL, rejecting malformed input, non-HTTP(S)
   * schemes, and embedded userinfo. Returns the canonical string form.
   * Final SSRF checks (scheme enforcement + private-IP resolution) are
   * performed by {@link assertUrlIsPublic}.
   */
  private validateUrl(rawUrl: string): string {
    if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
      throw new ValidationError('Import source URL is required', {
        url: ['Import source URL is required'],
      });
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    }
    catch {
      throw new ValidationError('Invalid import source URL', {
        url: ['Invalid URL format'],
      });
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ValidationError('Invalid import source URL', {
        url: ['URL must use http or https scheme'],
      });
    }

    if (parsed.username !== '' || parsed.password !== '') {
      throw new ValidationError('Invalid import source URL', {
        url: ['URL must not contain embedded credentials'],
      });
    }

    return parsed.toString();
  }

  /**
   * SSRF check at create time: resolve the hostname and reject if it maps
   * to a private / loopback / link-local address, or if the scheme is not
   * permitted by {@link validateUrlNotPrivate}.
   */
  private async assertUrlIsPublic(url: string): Promise<void> {
    try {
      await validateUrlNotPrivate(url);
    }
    catch (err) {
      logger.warn(
        { err, url: this.redactUrl(url) },
        'Rejected import source URL that failed SSRF validation',
      );
      throw new ValidationError('Import source URL failed safety checks', {
        url: ['URL is not permitted for import'],
      });
    }
  }

  /**
   * Enforce the per-calendar source cap. The cap is config-driven
   * (`calendar.import.maxSourcesPerCalendar`, default 10).
   */
  private async assertUnderSourceCap(calendarId: string): Promise<void> {
    const cap = this.getMaxSourcesPerCalendar();
    const count = await ImportSourceEntity.count({
      where: { calendar_id: calendarId },
    });

    if (count >= cap) {
      throw new ValidationError(
        `Calendar has reached the maximum of ${cap} import sources`,
        { url: [`Calendar has reached the maximum of ${cap} import sources`] },
      );
    }
  }

  /**
   * Reject duplicate URLs on the same calendar (case-insensitive hostname +
   * exact path comparison). Prevents accidental double-subscription to the
   * same feed on a single calendar.
   */
  private async assertUrlNotDuplicate(calendarId: string, url: string): Promise<void> {
    const existing = await ImportSourceEntity.findOne({
      where: { calendar_id: calendarId, url },
    });

    if (existing) {
      throw new ValidationError('Import source URL already exists on this calendar', {
        url: ['An import source with this URL already exists on this calendar'],
      });
    }
  }

  /**
   * Verify the account has edit access to the calendar. Throws
   * CalendarNotFoundError if missing and CalendarEditorPermissionError if
   * the account lacks access.
   */
  private async assertEditorAccess(account: Account, calendarId: string): Promise<void> {
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const calendarService = this.calendarService ?? new CalendarService();
    const canModify = await calendarService.userCanModifyCalendar(account, calendar);

    if (!canModify) {
      throw new CalendarEditorPermissionError();
    }
  }

  private async getCalendar(id: string) {
    if (this.calendarService) {
      return this.calendarService.getCalendar(id);
    }
    return new CalendarService().getCalendar(id);
  }

  private getMaxSourcesPerCalendar(): number {
    if (!config.has('calendar.import.maxSourcesPerCalendar')) {
      return DEFAULT_MAX_SOURCES_PER_CALENDAR;
    }
    const raw = config.get<number | string>('calendar.import.maxSourcesPerCalendar');
    const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_SOURCES_PER_CALENDAR;
  }

  /**
   * Strip any query string / fragment from a URL for log lines. The
   * privacy-playbook forbids putting raw fetch targets in logs; hostname
   * + path is enough to correlate.
   */
  private redactUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
    }
    catch {
      return '[unparseable]';
    }
  }
}

export default ImportSourceService;
