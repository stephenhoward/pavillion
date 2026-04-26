import crypto from 'crypto';
import dns from 'dns';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import config from 'config';
import * as cheerio from 'cheerio';
import { getPublicSuffix, parse as parseTld } from 'tldts';
import { Agent, request as undiciRequest } from 'undici';

import { Account } from '@/common/model/account';
import {
  ImportSource,
  ImportSourceVerificationType,
  IMPORT_SOURCE_VERIFICATION_TYPES,
} from '@/common/model/import_source';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import {
  ImportSourceNotFoundError,
  ImportSourceRelMeVerificationError,
  ImportSourceSsrfBlockedError,
  IMPORT_RELME_HOSTNAME_MISMATCH,
  IMPORT_RELME_LINK_NOT_FOUND,
  IMPORT_RELME_PAGE_FETCH_ERROR,
  IMPORT_RELME_PARSE_ERROR,
  IMPORT_RELME_PSL_VIOLATION,
} from '@/common/exceptions/import';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';
import { isPrivateIP, validateUrlNotPrivate } from '@/server/common/helper/ip-validation';
import { createIcsUrlValidator } from '@/server/common/helper/test-ssrf-gate';
import { createLogger } from '@/server/common/helper/logger';
import CalendarService from '@/server/calendar/service/calendar';
import { generateVerificationToken } from '@/server/calendar/service/import/hmac';
import { DnsVerifier, VERIFICATION_VALIDITY_DAYS } from '@/server/calendar/service/import/dns-verifier';
import type SyncService from '@/server/calendar/service/import/sync';
import type { SyncResult } from '@/server/calendar/service/import/sync';

const logger = createLogger('calendar.import.source');

/** Default cap when config value is absent. */
const DEFAULT_MAX_SOURCES_PER_CALENDAR = 10;

/** Maximum length of a user-supplied verification page URL. */
const RELME_PAGE_URL_MAX_LENGTH = 2048;

/** Maximum redirect hops for the rel-me page fetch. */
const RELME_MAX_REDIRECTS = 3;

/** Hard body cap for the rel-me page fetch (512 KB pre-decompression). */
const RELME_MAX_BODY_BYTES = 512 * 1024;

/** Per-phase timeouts for the rel-me page fetch (ms). */
const RELME_CONNECT_TIMEOUT_MS = 10_000;
const RELME_HEADERS_TIMEOUT_MS = 15_000;
const RELME_BODY_TIMEOUT_MS = 30_000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Promisified `dns.lookup` returning every resolved address. Used by the
 * rel-me HTML fetcher for SSRF resolution checks.
 */
const dnsLookupAll = promisify(dns.lookup) as unknown as (
  hostname: string,
  opts: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

/**
 * Minimal response shape returned by {@link HtmlFetcher.fetch}. Body is the
 * page contents up to the size cap; status is the final HTTP status code
 * after any redirect chain.
 */
export interface HtmlFetchResult {
  status: number;
  body: Buffer;
  finalUrl: string;
}

/**
 * Fetches an HTML page with SSRF defenses suitable for the rel-me verifier:
 * scheme + private-IP literal check, DNS resolution + per-IP private-range
 * check, redirect-chain revalidation, response-size cap, max-redirects cap.
 *
 * Defined as an interface so the {@link ImportSourceService} can accept a
 * fake fetcher in unit tests without exercising the real `undici` stack.
 */
export interface HtmlFetcher {
  fetch(url: string): Promise<HtmlFetchResult>;
}

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
 *                         dependent import_run rows and
 *                         event_import_origin sibling rows; associated
 *                         event rows are preserved and become
 *                         locally-owned (pv-picz sibling-table design)
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
  private dnsVerifier: DnsVerifier;
  private htmlFetcher: HtmlFetcher;
  private readonly urlSafetyValidator: (url: string) => Promise<boolean>;

  constructor(
    private calendarService?: CalendarService,
    private syncService?: SyncService,
    dnsVerifier?: DnsVerifier,
    urlSafetyValidator?: (url: string) => Promise<boolean>,
    htmlFetcher?: HtmlFetcher,
  ) {
    // calendarService is optional so callers in a future wiring pass can
    // inject the shared instance; when absent we fall back to loading the
    // calendar entity directly (mirrors WidgetConfigService).
    //
    // syncService is optional so tests can construct the service without
    // wiring a real sync pipeline; production wiring in CalendarInterface
    // injects the shared SyncService instance directly.
    this.dnsVerifier = dnsVerifier ?? new DnsVerifier();
    // Gate-aware default (pv-gdqp): strict `validateUrlNotPrivate` in
    // production, relaxed localhost-friendly validator when
    // ALLOW_LOCALHOST_ICS_IMPORT is open (test/e2e only). The gate is NOT
    // consulted inside `validateUrlNotPrivate` itself — this is the
    // ICS-owned opt-in site. Named distinctly from the service's private
    // `validateUrl()` method, which handles scheme/credentials checks.
    this.urlSafetyValidator = urlSafetyValidator ?? createIcsUrlValidator(validateUrlNotPrivate);
    // Default rel-me HTML fetcher: SSRF-hardened (DNS + per-IP private-range
    // check), redirect-chain revalidated, 512 KB cap, max 3 redirects. Tests
    // inject a fake to avoid real network I/O.
    this.htmlFetcher = htmlFetcher ?? new DefaultHtmlFetcher(this.urlSafetyValidator);
  }

  /**
   * Allow tests to inject a fake DnsVerifier after construction.
   */
  setDnsVerifier(verifier: DnsVerifier): void {
    this.dnsVerifier = verifier;
  }

  /**
   * Allow tests to inject a fake HtmlFetcher after construction.
   */
  setHtmlFetcher(fetcher: HtmlFetcher): void {
    this.htmlFetcher = fetcher;
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
      // Future call paths for rel-me / oauth sources must pass a different
      // verification_type here; keeping the stamp visible now establishes
      // the pattern before it has callers.
      verification_type: 'dns-txt',
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
   *  - `event_import_origin.import_source_id` is `ON DELETE CASCADE`
   *    (pv-picz sibling table — event rows are preserved and become
   *    locally-owned; orphan origin rows would carry no actionable data)
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

  /**
   * Issue (or re-issue) the verification challenge for a source.
   *
   * Returns the opaque HMAC token that the source-owning administrator
   * must publish — either in a DNS TXT record (for `'dns-txt'` sources) or
   * embedded in the well-known URL referenced by a `<a rel="me">` backlink
   * (for `'rel-me'` sources). The token is deterministic per
   * (sourceId, calendarId), so repeated calls return the same value —
   * which is safe because the token alone is useless without also
   * controlling the source's hostname DNS or hosting a backlink page on
   * the source hostname.
   *
   * Verification type semantics: when `verificationType` is supplied and
   * differs from the persisted value, the entity is updated and any prior
   * `verified_at` proof is cleared so the source must re-enter the verify
   * gate under the new mechanism. When the supplied type matches the
   * persisted value (or no type is supplied), the existing proof is left
   * intact.
   *
   * @param account - The requesting account (must own or edit the calendar)
   * @param calendarId - The calendar UUID
   * @param id - The import source UUID
   * @param verificationType - Optional verification mechanism to set on the
   *   source. Must be one of {@link IMPORT_SOURCE_VERIFICATION_TYPES}.
   *   When omitted, the persisted type is preserved.
   * @returns The verification token (owner-facing, not persisted on the
   *          returned model and not leaked via list/read responses)
   * @throws CalendarNotFoundError, CalendarEditorPermissionError,
   *         ImportSourceNotFoundError
   * @throws ValidationError when `verificationType` is supplied but is not
   *   one of the allowed values.
   */
  async issueVerificationChallenge(
    account: Account,
    calendarId: string,
    id: string,
    verificationType?: ImportSourceVerificationType,
  ): Promise<string> {
    await this.assertEditorAccess(account, calendarId);

    if (
      verificationType !== undefined
      && !IMPORT_SOURCE_VERIFICATION_TYPES.includes(verificationType)
    ) {
      throw new ValidationError('Invalid verification type', {
        verification_type: ['Invalid verification type'],
      });
    }

    const entity = await ImportSourceEntity.findOne({
      where: { id, calendar_id: calendarId },
    });
    if (!entity) {
      throw new ImportSourceNotFoundError();
    }

    // Derive token deterministically. Always re-derive (rather than relying
    // on a stored value) so callers receive the current HMAC output if the
    // instance secret is ever rotated — stored column is authoritative only
    // for the DNS verifier, which recomputes via formatVerificationRecord.
    const token = generateVerificationToken(id, calendarId);

    // Persist on the entity so a later verification + token inspection path
    // can compare. Also bump state to 'pending' if it's still 'unverified'
    // so the admin UI reflects that a challenge has been issued.
    entity.verification_token = token;

    // Resolve the next verification type. When the caller omits
    // `verificationType`, preserve whatever the entity already carries —
    // this keeps the ungated /verify-issue path backwards compatible with
    // pre-rel-me callers and pre-existing rows.
    const nextType = verificationType ?? entity.verification_type;
    if (nextType !== entity.verification_type) {
      // Switching mechanism invalidates the previous proof: the new
      // mechanism has not been satisfied yet. Clear `verified_at` so the
      // source re-enters the verify gate under the new mechanism.
      entity.verification_type = nextType;
      entity.verified_at = null;
    }
    else {
      // Belt-and-braces stamp — guarantees pre-existing rows that may have
      // been seeded without the column populated still carry an explicit
      // discriminator. No-op when already set.
      entity.verification_type = nextType;
    }

    if (entity.verification_state === 'unverified') {
      entity.verification_state = 'pending';
    }
    await entity.save();

    return token;
  }

  /**
   * Run ownership verification for an import source and persist the outcome.
   *
   * Dispatches on the source's `verification_type` discriminator:
   *  - `'dns-txt'` → {@link verifyDnsTxtSource} (DoH-based TXT lookup)
   *  - `'rel-me'`  → {@link verifyRelMeSource} (HTML page rel="me" backlink)
   *
   * On success the entity's `verification_state` transitions to `'verified'`,
   * `verified_at` is set to now, and `verification_expires_at` is stamped to
   * now + 90 days. On any failure the entity is left untouched so the caller
   * can retry after fixing the underlying issue.
   *
   * NOTE: This dispatcher uses a switch for two verification types. Adding a
   * THIRD verification type (e.g. OAuth) is the trigger to refactor into a
   * strategy registry — the per-type method bodies are already encapsulated
   * to make that refactor mechanical when it is needed.
   *
   * @param account - The requesting account (must own or edit the calendar)
   * @param calendarId - The calendar UUID
   * @param id - The import source UUID
   * @param verificationPageUrl - For `'rel-me'` sources only: the URL of the
   *   page hosting the `<a rel="me">` / `<link rel="me">` backlink. Required
   *   for `'rel-me'`; ignored otherwise.
   * @returns The updated ImportSource model
   * @throws CalendarNotFoundError, CalendarEditorPermissionError,
   *         ImportSourceNotFoundError, ImportSourceDnsVerificationError,
   *         ImportSourceRelMeVerificationError, ImportSourceSsrfBlockedError
   */
  async verifySource(
    account: Account,
    calendarId: string,
    id: string,
    verificationPageUrl?: string,
  ): Promise<ImportSource> {
    await this.assertEditorAccess(account, calendarId);

    const entity = await ImportSourceEntity.findOne({
      where: { id, calendar_id: calendarId },
    });
    if (!entity) {
      throw new ImportSourceNotFoundError();
    }

    // Dispatch on the verification-type discriminator. Each branch may throw
    // a sanitized domain exception that the API layer translates to the
    // canonical HTTP response.
    //
    // Adding a THIRD verification type is the trigger to refactor this switch
    // into a strategy registry; for two types the branching is mechanical and
    // the local cohesion is worth more than the indirection.
    switch (entity.verification_type) {
      case 'dns-txt':
        return this.verifyDnsTxtSource(entity);
      case 'rel-me':
        return this.verifyRelMeSource(entity, verificationPageUrl);
      default: {
        // Exhaustiveness guard. If a future migration adds a new enum value
        // without a matching dispatcher branch, fail loudly rather than
        // silently treating it as a verification success.
        const _exhaustive: never = entity.verification_type;
        throw new Error(`Unsupported verification type: ${String(_exhaustive)}`);
      }
    }
  }

  /**
   * DNS TXT verification branch of {@link verifySource}. Delegates to the
   * injected {@link DnsVerifier} which throws
   * {@link ImportSourceDnsVerificationError} on any non-success.
   */
  private async verifyDnsTxtSource(entity: ImportSourceEntity): Promise<ImportSource> {
    const result = await this.dnsVerifier.verify({
      sourceId: entity.id,
      calendarId: entity.calendar_id,
      sourceUrl: entity.url,
    });

    entity.verification_state = 'verified';
    entity.verified_at = result.verifiedAt;
    entity.verification_expires_at = result.expiresAt;
    await entity.save();

    logger.info(
      { calendarId: entity.calendar_id, importSourceId: entity.id },
      'Import source DNS verification succeeded',
    );

    return entity.toModel();
  }

  /**
   * `rel="me"` verification branch of {@link verifySource}. Validates the
   * caller-supplied verification page URL, fetches it under SSRF protections,
   * parses the HTML with cheerio, and looks for an `<a rel="me">` or
   * `<link rel="me">` element whose `href` matches the source's expected
   * verification URL via timing-safe comparison.
   *
   * Security mitigations baked in (per security-advisor on epic pv-jutm):
   *  - Verification page URL must parse as a URL, use `https:` only, have
   *    hostname EXACTLY equal to the source URL hostname (NOT eTLD+1), and
   *    be at most {@link RELME_PAGE_URL_MAX_LENGTH} characters.
   *  - PSL guard: the verification page hostname must sit strictly below the
   *    public suffix on the PSL (rejects `co.uk`, `github.io`, etc.). This
   *    is checked BEFORE any fetch is issued.
   *  - SSRF: every URL in the redirect chain is revalidated by the HTML
   *    fetcher; private-IP resolutions throw {@link ImportSourceSsrfBlockedError}.
   *  - Body size: 512 KB cap; over-cap aborts with `IMPORT_RELME_PAGE_FETCH_ERROR`.
   *  - Redirects: max {@link RELME_MAX_REDIRECTS} hops.
   *  - HTML parsed by cheerio (no regex). Multi-value `rel` attributes
   *    (e.g. `rel="me noopener"`) and reversed attribute orders are
   *    supported because cheerio normalizes them.
   *  - Token URL comparison uses {@link crypto.timingSafeEqual} on Buffer
   *    representations to avoid leaking equality progress through timing.
   *
   * Logging discipline: structured log fields contain only `sourceId` and a
   * `reason` code — the user-supplied verification page URL never appears in
   * structured fields (privacy-playbook).
   */
  private async verifyRelMeSource(
    entity: ImportSourceEntity,
    verificationPageUrl: string | undefined,
  ): Promise<ImportSource> {
    const sourceHostname = hostnameFromUrl(entity.url);
    if (!sourceHostname) {
      // Defensive: entity.url passed createSource validation, so this should
      // be unreachable in practice. Fail closed if it ever occurs.
      logger.warn(
        { importSourceId: entity.id, reason: IMPORT_RELME_HOSTNAME_MISMATCH },
        'rel-me verification rejected: source URL has no hostname',
      );
      throw new ImportSourceRelMeVerificationError(IMPORT_RELME_HOSTNAME_MISMATCH);
    }

    // 1. Validate the user-supplied verification page URL.
    const pageHostname = this.validateRelMePageUrl(
      verificationPageUrl,
      sourceHostname,
      entity.id,
    );

    // 2. PSL guard: hostname must sit strictly below its public suffix. This
    //    runs BEFORE any fetch so a hostname at/above the PSL never causes
    //    outbound traffic to a shared-tenancy host.
    if (!passesPslCheck(pageHostname)) {
      logger.warn(
        { importSourceId: entity.id, reason: IMPORT_RELME_PSL_VIOLATION },
        'rel-me verification rejected: verification page hostname is at/above the public suffix',
      );
      throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PSL_VIOLATION);
    }

    // 3. Compute the expected rel="me" target URL from the source token.
    //    The token is derived deterministically; we never store the URL.
    const token = generateVerificationToken(entity.id, entity.calendar_id);
    const instanceHost = config.get<string>('domain');
    const expectedRelMeUrl = `https://${instanceHost}/.well-known/pavillion-verify/${token}`;

    // 4. Fetch the page under SSRF protections. The fetcher revalidates each
    //    redirect hop and throws ImportSourceSsrfBlockedError if any URL in
    //    the chain (including the original) resolves to a private address.
    let pageBody: string;
    try {
      const fetchResult = await this.htmlFetcher.fetch(verificationPageUrl as string);
      pageBody = fetchResult.body.toString('utf8');
    }
    catch (err) {
      if (err instanceof ImportSourceSsrfBlockedError) {
        // SSRF blocks reuse the existing exception type so the API serializer
        // and i18n key handling stay uniform across all outbound import
        // fetches. No new SSRF reason on the rel-me exception by design.
        logger.warn(
          { importSourceId: entity.id, reason: 'ssrf_blocked' },
          'rel-me verification page fetch blocked by SSRF policy',
        );
        throw err;
      }
      logger.info(
        { importSourceId: entity.id, reason: IMPORT_RELME_PAGE_FETCH_ERROR },
        'rel-me verification page fetch failed',
      );
      throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PAGE_FETCH_ERROR);
    }

    // 5. Parse the page with cheerio and walk every <a rel="me"> / <link
    //    rel="me"> element. cheerio normalizes attribute order and tokenizes
    //    the rel attribute, so we accept rel="me", rel="me noopener", etc.
    let $: cheerio.CheerioAPI;
    try {
      $ = cheerio.load(pageBody);
    }
    catch {
      logger.info(
        { importSourceId: entity.id, reason: IMPORT_RELME_PARSE_ERROR },
        'rel-me verification page parse failed',
      );
      throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PARSE_ERROR);
    }

    if (!hasMatchingRelMeLink($, expectedRelMeUrl)) {
      logger.info(
        { importSourceId: entity.id, reason: IMPORT_RELME_LINK_NOT_FOUND },
        'rel-me verification: no matching <a|link rel="me"> backlink found',
      );
      throw new ImportSourceRelMeVerificationError(IMPORT_RELME_LINK_NOT_FOUND);
    }

    // 6. Persist the verification stamp. Same 90-day window as DNS so both
    //    branches share the renewal cadence.
    const verifiedAt = new Date();
    const expiresAt = new Date(verifiedAt.getTime() + VERIFICATION_VALIDITY_DAYS * MS_PER_DAY);
    entity.verification_state = 'verified';
    entity.verified_at = verifiedAt;
    entity.verification_expires_at = expiresAt;
    await entity.save();

    logger.info(
      { calendarId: entity.calendar_id, importSourceId: entity.id },
      'Import source rel-me verification succeeded',
    );

    return entity.toModel();
  }

  /**
   * Validate the user-supplied `verificationPageUrl`. Throws
   * {@link ImportSourceRelMeVerificationError} on any structural failure;
   * returns the verified hostname on success so the caller can run the PSL
   * guard without re-parsing.
   *
   * Validation rules (security-advisor):
   *  - Required, string-typed, non-empty
   *  - Length <= {@link RELME_PAGE_URL_MAX_LENGTH}
   *  - Parses as a URL
   *  - Scheme is `https:` only (no http, no ftp, no file, no data)
   *  - Hostname equals the source URL hostname EXACTLY (case-insensitive,
   *    no eTLD+1 fallback). Shared-tenancy hosts (alice.github.io vs
   *    bob.github.io) MUST NOT be confusable here.
   */
  private validateRelMePageUrl(
    rawUrl: string | undefined,
    sourceHostname: string,
    sourceId: string,
  ): string {
    if (
      rawUrl === undefined
      || rawUrl === null
      || typeof rawUrl !== 'string'
      || rawUrl.trim().length === 0
    ) {
      throw new ValidationError('Verification page URL is required', {
        verification_page_url: ['Verification page URL is required'],
      });
    }

    if (rawUrl.length > RELME_PAGE_URL_MAX_LENGTH) {
      throw new ValidationError('Verification page URL is too long', {
        verification_page_url: ['Verification page URL is too long'],
      });
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    }
    catch {
      throw new ValidationError('Invalid verification page URL', {
        verification_page_url: ['Invalid URL format'],
      });
    }

    if (parsed.protocol !== 'https:') {
      throw new ValidationError('Invalid verification page URL', {
        verification_page_url: ['Verification page URL must use https'],
      });
    }

    const pageHostname = parsed.hostname.toLowerCase();
    if (pageHostname !== sourceHostname.toLowerCase()) {
      // Full-hostname equality (NOT eTLD+1). Bypass via a sibling subdomain
      // on a shared host is the explicit attack model here.
      logger.warn(
        { importSourceId: sourceId, reason: IMPORT_RELME_HOSTNAME_MISMATCH },
        'rel-me verification rejected: page hostname does not match source hostname',
      );
      throw new ImportSourceRelMeVerificationError(IMPORT_RELME_HOSTNAME_MISMATCH);
    }

    return pageHostname;
  }

  /**
   * Trigger a manual sync run for an import source. The service enforces
   * editor access and then delegates the full pipeline (fetch → parse →
   * persist → record ImportRun) to the SyncService orchestrator.
   *
   * @param account - The requesting account (must own or edit the calendar)
   * @param calendarId - The calendar UUID
   * @param id - The import source UUID
   * @returns Summary of the sync run
   * @throws CalendarNotFoundError, CalendarEditorPermissionError,
   *         ImportSourceNotFoundError, ImportSourceVerifyRateLimitError,
   *         and any sanitized ImportSource*Error from the pipeline.
   */
  async syncSource(
    account: Account,
    calendarId: string,
    id: string,
  ): Promise<SyncResult> {
    await this.assertEditorAccess(account, calendarId);

    const entity = await ImportSourceEntity.findOne({
      where: { id, calendar_id: calendarId },
    });
    if (!entity) {
      throw new ImportSourceNotFoundError();
    }

    if (!this.syncService) {
      throw new Error('ImportSourceService.syncSource called without SyncService wiring');
    }

    return this.syncService.syncSource({ account, importSourceId: id });
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  /**
   * Parse and normalize the URL, rejecting malformed input, non-HTTP(S)
   * schemes, and embedded userinfo. Returns the canonical string form.
   * Inputs without an explicit scheme default to `https://` so calendar
   * owners can paste a bare hostname (e.g. `example.com/cal.ics`).
   * Final SSRF checks (scheme enforcement + private-IP resolution) are
   * performed by {@link assertUrlIsPublic}.
   */
  private validateUrl(rawUrl: string): string {
    if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
      throw new ValidationError('Import source URL is required', {
        url: ['Import source URL is required'],
      });
    }

    const trimmed = rawUrl.trim();
    // RFC 3986 scheme syntax: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
    const candidate = hasScheme ? trimmed : `https://${trimmed}`;

    let parsed: URL;
    try {
      parsed = new URL(candidate);
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
      await this.urlSafetyValidator(url);
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

// ---------------------------------------------------------------------------
// Module-private helpers (rel-me verifier)
// ---------------------------------------------------------------------------

/**
 * Extracts the lowercased hostname from a URL string. Returns null if the
 * URL is unparseable or has no hostname.
 */
function hostnameFromUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    return u.hostname.toLowerCase() || null;
  }
  catch {
    return null;
  }
}

/**
 * PSL guard: a hostname must sit strictly below its public suffix on the
 * Public Suffix List. Returns true when the hostname is safe (a registrable
 * domain or a label below one), false when the hostname equals or sits at
 * the public suffix (e.g. `co.uk`, `github.io`, bare `com`).
 *
 * Mirrors the same check used by {@link DnsVerifier} so both verifier
 * branches reject shared-tenancy hosts identically.
 */
function passesPslCheck(hostname: string): boolean {
  const parsed = parseTld(hostname);
  if (!parsed || !parsed.hostname) {
    return false;
  }
  if (!parsed.domain) {
    return false;
  }
  const suffix = getPublicSuffix(hostname);
  if (suffix && suffix === hostname) {
    return false;
  }
  return true;
}

/**
 * Returns true if any `<a rel="me" href=...>` or `<link rel="me" href=...>`
 * element on the page resolves to the expected URL. Multi-value `rel`
 * attributes (e.g. `rel="me noopener"`) are tokenized and checked.
 *
 * Comparison uses {@link crypto.timingSafeEqual} on Buffer representations
 * of the canonicalized URLs to avoid leaking equality progress through
 * timing. We canonicalize (re-parse) both sides so trivial syntactic
 * differences (default port, trailing slash) do not produce false negatives.
 */
function hasMatchingRelMeLink($: cheerio.CheerioAPI, expectedUrl: string): boolean {
  const expectedCanonical = canonicalizeUrl(expectedUrl);
  if (expectedCanonical === null) {
    // Defensive: should be unreachable since the caller computes
    // expectedUrl from a config-known host plus an HMAC-derived token.
    return false;
  }
  const expectedBuf = Buffer.from(expectedCanonical, 'utf8');

  let matched = false;
  $('a[rel], link[rel]').each((_idx, el) => {
    if (matched) return;
    const relAttr = $(el).attr('rel');
    if (!relAttr) return;
    const tokens = relAttr.split(/\s+/).map(t => t.toLowerCase());
    if (!tokens.includes('me')) return;

    const href = $(el).attr('href');
    if (!href) return;
    const hrefCanonical = canonicalizeUrl(href);
    if (hrefCanonical === null) return;

    const hrefBuf = Buffer.from(hrefCanonical, 'utf8');
    if (hrefBuf.length !== expectedBuf.length) return;
    if (crypto.timingSafeEqual(hrefBuf, expectedBuf)) {
      matched = true;
    }
  });
  return matched;
}

/**
 * Canonicalize a URL for byte-equality comparison. Returns the parsed URL's
 * `.toString()` (which normalizes default ports, percent-encoding, etc.) or
 * null when the input is not a parseable URL. Relative URLs are not
 * accepted — the rel-me expected URL is always absolute, and any relative
 * `href` on the page would not match an absolute expected URL anyway.
 */
function canonicalizeUrl(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).toString();
  }
  catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Default rel-me HTML fetcher (SSRF-hardened)
// ---------------------------------------------------------------------------

/**
 * Production HTML fetcher used by the rel-me verifier. Mirrors the SSRF
 * protections of {@link Fetcher} (the ICS fetcher) but targeted at HTML:
 *
 *  - Validates URL scheme + literal IP at every redirect hop
 *  - DNS-resolves the hostname and rejects any private/loopback/link-local
 *    address by throwing {@link ImportSourceSsrfBlockedError}
 *  - Pins the socket to the validated IP via a per-request `undici.Agent`
 *    so a second DNS resolution at connect time cannot rebind to a
 *    different address (DNS-rebinding defense)
 *  - Caps the response body at {@link RELME_MAX_BODY_BYTES} (512 KB)
 *  - Caps the redirect chain at {@link RELME_MAX_REDIRECTS} (3)
 *
 * Construction takes the gate-aware URL safety validator so test/e2e
 * environments with `ALLOW_LOCALHOST_ICS_IMPORT=true` can fetch from
 * localhost fixtures without disabling production-strict validation.
 */
class DefaultHtmlFetcher implements HtmlFetcher {
  constructor(
    private readonly urlSafetyValidator: (url: string) => Promise<boolean>,
  ) {}

  async fetch(initialUrl: string): Promise<HtmlFetchResult> {
    let currentUrl = initialUrl;
    const agents: Agent[] = [];

    try {
      // RELME_MAX_REDIRECTS is a HOP ceiling: indices 0..MAX-1 are valid;
      // an attempted hop at index MAX is rejected as "too many redirects".
      for (let hop = 0; hop < RELME_MAX_REDIRECTS + 1; hop++) {
        if (hop === RELME_MAX_REDIRECTS + 1) {
          // Defensive — loop condition prevents this.
          break;
        }

        // 1. Validate URL (scheme + IP-literal private check). Reuses the
        //    same gate-aware validator the ICS fetcher uses so the
        //    ALLOW_LOCALHOST_ICS_IMPORT gate behaves identically here.
        try {
          await this.urlSafetyValidator(currentUrl);
        }
        catch {
          throw new ImportSourceSsrfBlockedError({ reason: 'url_failed_validation' });
        }

        const parsedUrl = new URL(currentUrl);
        const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '');

        // 2. Resolve hostname → IPs and reject any private address. Mirrors
        //    the per-IP check in the ICS Fetcher so a hostname like
        //    `localtest.me` (which resolves to 127.0.0.1) is blocked even
        //    though its name parses cleanly.
        let addresses: Array<{ address: string; family: number }>;
        try {
          addresses = await dnsLookupAll(hostname, { all: true, verbatim: true });
        }
        catch {
          throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PAGE_FETCH_ERROR);
        }
        if (addresses.length === 0) {
          throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PAGE_FETCH_ERROR);
        }
        for (const { address } of addresses) {
          if (isPrivateIP(address)) {
            throw new ImportSourceSsrfBlockedError({ reason: 'private_ip_resolved' });
          }
        }

        // 3. Pick the first validated IP and build a pinned Agent.
        const pinnedIp = addresses[0].address;
        const agent = createPinnedAgent(pinnedIp);
        agents.push(agent);

        // 4. Issue the request. Manual redirect handling — `maxRedirections: 0`
        //    forces undici to surface 3xx responses to us so we can revalidate
        //    the next hop before any further connection is made.
        let response;
        try {
          response = await undiciRequest(currentUrl, {
            method: 'GET',
            headers: {
              'user-agent': 'Pavillion/rel-me-verifier (+https://pavillion.app)',
              'accept': 'text/html, application/xhtml+xml;q=0.9, */*;q=0.1',
            },
            dispatcher: agent,
            maxRedirections: 0,
            headersTimeout: RELME_HEADERS_TIMEOUT_MS,
            bodyTimeout: RELME_BODY_TIMEOUT_MS,
          });
        }
        catch {
          throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PAGE_FETCH_ERROR);
        }

        const status = response.statusCode;
        const headers = response.headers as Record<string, string | string[] | undefined>;
        const body = response.body as unknown as AsyncIterable<Uint8Array>;

        // Redirect handling: drain body, revalidate the next URL on next
        // iteration. The fetched-URL validation at the top of the loop is
        // the redirect-chain SSRF defense.
        if (status >= 300 && status < 400) {
          const location = extractHeader(headers, 'location');
          if (!location) {
            throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PAGE_FETCH_ERROR);
          }
          await drainBody(body);
          if (hop + 1 >= RELME_MAX_REDIRECTS + 1) {
            throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PAGE_FETCH_ERROR);
          }
          let nextUrl: URL;
          try {
            nextUrl = new URL(location, currentUrl);
          }
          catch {
            throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PAGE_FETCH_ERROR);
          }
          currentUrl = nextUrl.toString();
          continue;
        }

        if (status < 200 || status >= 300) {
          await drainBody(body);
          throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PAGE_FETCH_ERROR);
        }

        // 5. Stream body with hard cap. We do NOT trust Content-Length.
        const bodyBuf = await readBodyCapped(body, RELME_MAX_BODY_BYTES);

        return {
          status,
          body: bodyBuf,
          finalUrl: currentUrl,
        };
      }

      // Unreachable — loop only exits via return or throw.
      throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PAGE_FETCH_ERROR);
    }
    finally {
      for (const agent of agents) {
        void agent.close().catch(() => { /* swallow */ });
      }
    }
  }
}

/**
 * Build an undici Agent whose `connect.lookup` always resolves to the given
 * IP. This pins the socket to a previously-validated address, defeating
 * DNS-rebinding attacks at the socket layer (a second DNS resolution at
 * connect time cannot redirect the connection).
 */
function createPinnedAgent(pinnedIp: string): Agent {
  return new Agent({
    connect: {
      lookup: (
        _hostname: string,
        options: unknown,
        callback: (
          err: NodeJS.ErrnoException | null,
          addressOrAddresses: string | Array<{ address: string; family: number }>,
          family?: number,
        ) => void,
      ) => {
        const family = pinnedIp.includes(':') ? 6 : 4;
        const wantsAll = typeof options === 'object'
          && options !== null
          && (options as { all?: unknown }).all === true;
        if (wantsAll) {
          callback(null, [{ address: pinnedIp, family }]);
        }
        else {
          callback(null, pinnedIp, family);
        }
      },
      timeout: RELME_CONNECT_TIMEOUT_MS,
    },
  });
}

function extractHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

async function drainBody(body: AsyncIterable<Uint8Array>): Promise<void> {
  try {
    for await (const _chunk of body) {
      // discard
    }
  }
  catch {
    // swallow
  }
}

/**
 * Read an async-iterable body into a Buffer, aborting as soon as the
 * accumulated size exceeds `limit`. Over-cap and mid-stream errors both
 * surface as IMPORT_RELME_PAGE_FETCH_ERROR so the caller does not have to
 * distinguish between transport failure and over-cap.
 */
async function readBodyCapped(
  body: AsyncIterable<Uint8Array>,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > limit) {
        throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PAGE_FETCH_ERROR);
      }
      chunks.push(buf);
    }
  }
  catch (err) {
    if (err instanceof ImportSourceRelMeVerificationError) throw err;
    throw new ImportSourceRelMeVerificationError(IMPORT_RELME_PAGE_FETCH_ERROR);
  }
  return Buffer.concat(chunks, total);
}
