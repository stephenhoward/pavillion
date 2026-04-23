/**
 * CLI adapter for the ICS sync orchestrator (pv-1qcp.2.5).
 *
 * This module is the dogfooding entry point used to manually sync an import
 * source (or all verified sources on a calendar) from the command line before
 * the admin UI lands. It is intentionally a thin adapter: all business logic
 * lives in {@link SyncService} (pv-1qcp.2.4) and
 * {@link ImportSourceService} (pv-1qcp.1.4).
 *
 * Responsibilities:
 *  - Parse either `--source-id` or `--calendar-id` (exactly one required)
 *  - Resolve the calendar owner account for the sync dispatcher
 *  - Invoke {@link SyncService.syncSource} once per source
 *  - Print a one-line summary per source to stdout
 *  - Emit sanitized error lines to stderr on any failure outcome
 *  - Return a non-zero exit code if any sync produced a failure outcome
 *
 * Error sanitization: we only print stable error codes (the sanitized
 * `errorMessage` field on {@link SyncResult}) and the error *name* for thrown
 * exceptions. Raw URLs, fetch bodies, stack traces, and resolver data never
 * reach stdout or stderr — see privacy-playbook.
 *
 * @see bead pv-1qcp.2.5
 */

import type { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import {
  ImportSourceNotFoundError,
  ImportSourceVerifyRateLimitError,
} from '@/common/exceptions/import';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';
import type SyncService from '@/server/calendar/service/import/sync';
import type { SyncResult } from '@/server/calendar/service/import/sync';
import type { ImportRunOutcome } from '@/server/calendar/entity/import_run';

/**
 * Outcomes that indicate a successful run. Anything else contributes to a
 * non-zero CLI exit code.
 */
const SUCCESS_OUTCOMES: ReadonlySet<ImportRunOutcome> = new Set<ImportRunOutcome>([
  'success',
  'no_changes',
]);

/**
 * Minimal interface shape the CLI needs from the account resolver. Keeping
 * this narrow lets the caller wire either the real accounts interface or a
 * test stub without pulling in the whole account service.
 */
export interface AccountResolver {
  getAccountById(id: string): Promise<Account | undefined>;
}

/**
 * Minimal interface shape the CLI needs from the calendar service to find
 * the calendar owner account id for a given calendar id.
 */
export interface CalendarOwnerResolver {
  getCalendarOwnerAccountId(calendarId: string): Promise<string | null>;
}

export interface ImportSyncCliOptions {
  sourceId?: string;
  calendarId?: string;
}

export interface ImportSyncCliDeps {
  syncService: SyncService;
  accountResolver: AccountResolver;
  calendarOwnerResolver: CalendarOwnerResolver;
  /**
   * IO sinks. Defaulted to the real process streams by {@link runImportSync};
   * tests override to capture output.
   */
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

export interface ImportSyncCliResult {
  /** Exit code: 0 if every processed source finished in a success outcome. */
  exitCode: 0 | 1;
  /** Per-source results in dispatch order. */
  runs: Array<{ sourceId: string; result: SyncResult | null; error: string | null }>;
}

/**
 * Entry point used by both the CLI registrar and the unit tests.
 *
 * Accepts already-parsed options and fully-wired dependencies. The real CLI
 * wrapper in `src/server/cli/index.ts` is the thin shell that constructs
 * these from commander + the domain interfaces.
 */
export async function runImportSync(
  options: ImportSyncCliOptions,
  deps: ImportSyncCliDeps,
): Promise<ImportSyncCliResult> {
  const stdout = deps.stdout ?? ((line: string) => process.stdout.write(line + '\n'));
  const stderr = deps.stderr ?? ((line: string) => process.stderr.write(line + '\n'));

  // Arg validation — exactly one of --source-id / --calendar-id.
  const hasSource = typeof options.sourceId === 'string' && options.sourceId.length > 0;
  const hasCalendar = typeof options.calendarId === 'string' && options.calendarId.length > 0;
  if (hasSource === hasCalendar) {
    stderr('error: exactly one of --source-id or --calendar-id is required');
    return { exitCode: 1, runs: [] };
  }

  let sourceIds: string[];
  let calendarIdForOwnerLookup: string;

  if (hasSource) {
    const source = await ImportSourceEntity.findByPk(options.sourceId!);
    if (!source) {
      stderr(`error: import source not found: ${options.sourceId}`);
      return { exitCode: 1, runs: [] };
    }
    sourceIds = [source.id];
    calendarIdForOwnerLookup = source.calendar_id;
  }
  else {
    // Enumerate verified sources for the calendar. Unverified / pending /
    // expired-past-grace are skipped — syncSource() would reject them anyway.
    const sources = await ImportSourceEntity.findAll({
      where: {
        calendar_id: options.calendarId!,
        verification_state: 'verified',
      },
      order: [['created_at', 'ASC']],
    });
    if (sources.length === 0) {
      stdout(`no verified sources found for calendar ${options.calendarId}`);
      return { exitCode: 0, runs: [] };
    }
    sourceIds = sources.map(s => s.id);
    calendarIdForOwnerLookup = options.calendarId!;
  }

  // Resolve the calendar-owner account the sync will be dispatched as. The
  // API path passes the requesting user; here we use the calendar owner as
  // the stand-in, which is the permissions-appropriate principal.
  const ownerId = await deps.calendarOwnerResolver.getCalendarOwnerAccountId(calendarIdForOwnerLookup);
  if (!ownerId) {
    stderr(`error: calendar owner not found for calendar ${calendarIdForOwnerLookup}`);
    return { exitCode: 1, runs: [] };
  }

  const ownerAccount = await deps.accountResolver.getAccountById(ownerId);
  if (!ownerAccount) {
    stderr(`error: calendar owner account not found: ${ownerId}`);
    return { exitCode: 1, runs: [] };
  }

  const runs: ImportSyncCliResult['runs'] = [];
  let anyFailure = false;

  for (const sourceId of sourceIds) {
    try {
      const result = await deps.syncService.syncSource({
        account: ownerAccount,
        importSourceId: sourceId,
      });

      const line =
        `source=${sourceId} `
        + `created=${result.eventsCreated} `
        + `updated=${result.eventsUpdated} `
        + `skipped=${result.eventsSkippedLocallyEdited} `
        + `outcome=${result.outcome}`;
      stdout(line);

      if (!SUCCESS_OUTCOMES.has(result.outcome)) {
        // Failure outcomes still produce an ImportRun row; print the
        // sanitized error code (never the raw message) to stderr.
        const errCode = result.errorMessage ?? result.outcome;
        stderr(`error: source=${sourceId} ${errCode}`);
        anyFailure = true;
      }

      runs.push({ sourceId, result, error: null });
    }
    catch (err) {
      // Thrown errors (not-found, rate-limit, not-verified) bypass the
      // ImportRun recording path. We surface only the error name — never the
      // raw message, which might embed a URL or stack.
      const errName = sanitizedThrownErrorCode(err);
      stderr(`error: source=${sourceId} ${errName}`);
      runs.push({ sourceId, result: null, error: errName });
      anyFailure = true;
    }
  }

  return { exitCode: anyFailure ? 1 : 0, runs };
}

/**
 * Translate thrown errors into stable identifier codes. Raw `err.message` is
 * intentionally avoided — it could carry a URL, token, or resolver hostname.
 */
function sanitizedThrownErrorCode(err: unknown): string {
  if (err instanceof ImportSourceNotFoundError) return 'IMPORT_SOURCE_NOT_FOUND';
  if (err instanceof ImportSourceVerifyRateLimitError) return 'IMPORT_RATE_LIMITED';
  if (err instanceof Error) {
    // Error *name* is curated by our exception classes; it's safe to print.
    return err.name || 'UNKNOWN_ERROR';
  }
  return 'UNKNOWN_ERROR';
}

/**
 * Factory used by the CLI registrar to wire a fully-realized sync service
 * with its default fetcher, parser, and rate limiter. Separated from
 * {@link runImportSync} so tests never need to instantiate the heavy deps.
 */
export async function buildImportSyncDeps(
  eventBus: EventEmitter,
): Promise<Pick<ImportSyncCliDeps, 'syncService' | 'accountResolver' | 'calendarOwnerResolver'>> {
  // Dynamic imports — heavy modules (node-ical, full calendar interface)
  // must not load when the CLI runs unrelated subcommands.
  const [
    { default: CalendarInterface },
    { default: AccountsInterface },
    { default: ConfigurationInterface },
    { default: SetupInterface },
    { default: SyncServiceCtor },
  ] = await Promise.all([
    import('@/server/calendar/interface'),
    import('@/server/accounts/interface'),
    import('@/server/configuration/interface'),
    import('@/server/setup/interface'),
    import('@/server/calendar/service/import/sync'),
  ]);

  const calendarInterface = new CalendarInterface(eventBus);
  const configurationInterface = new ConfigurationInterface();
  const setupInterface = new SetupInterface();
  const accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);

  // Pull the already-wired EventService out of the calendar interface so
  // event-bus emissions (media reconciliation, instance refresh, federation)
  // fire through the same pipeline used by the HTTP API path.
  const eventService = (calendarInterface as unknown as {
    eventService: import('@/server/calendar/service/events').default;
  }).eventService;

  const syncService = new SyncServiceCtor({ eventService });

  const calendarOwnerResolver: CalendarOwnerResolver = {
    getCalendarOwnerAccountId: (calendarId: string) => calendarInterface.getCalendarOwnerAccountId(calendarId),
  };

  const accountResolver: AccountResolver = {
    getAccountById: (id: string) => accountsInterface.getAccountById(id),
  };

  return { syncService, accountResolver, calendarOwnerResolver };
}
