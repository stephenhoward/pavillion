import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import {
  ImportSourceNotFoundError,
  ImportSourceVerifyRateLimitError,
} from '@/common/exceptions/import';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';
import type SyncService from '@/server/calendar/service/import/sync';
import type { SyncResult } from '@/server/calendar/service/import/sync';
import {
  runImportSync,
  type AccountResolver,
  type CalendarOwnerResolver,
  type ImportSyncCliDeps,
} from '@/server/calendar/cli/import-sync';

/**
 * Unit tests for the ICS sync CLI adapter (pv-1qcp.2.5).
 *
 * These tests exercise the adapter's dispatch / output / exit-code behavior.
 * All persistence and sync logic is stubbed. Real sync-pipeline behavior is
 * covered by `service/import/test/sync.test.ts` and the sync integration
 * spec.
 */
describe('runImportSync (CLI adapter)', () => {
  let sandbox: sinon.SinonSandbox;
  let stdoutLines: string[];
  let stderrLines: string[];
  let syncService: SyncService;
  let accountResolver: AccountResolver;
  let calendarOwnerResolver: CalendarOwnerResolver;
  let deps: ImportSyncCliDeps;
  let testAccount: Account;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    stdoutLines = [];
    stderrLines = [];
    testAccount = new Account('owner-account-id', 'owner', 'owner@pavillion.test');

    syncService = { syncSource: sandbox.stub() } as unknown as SyncService;
    accountResolver = { getAccountById: sandbox.stub().resolves(testAccount) };
    calendarOwnerResolver = {
      getCalendarOwnerAccountId: sandbox.stub().resolves('owner-account-id'),
    };

    deps = {
      syncService,
      accountResolver,
      calendarOwnerResolver,
      stdout: (line: string) => stdoutLines.push(line),
      stderr: (line: string) => stderrLines.push(line),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  function makeResult(overrides: Partial<SyncResult> = {}): SyncResult {
    return {
      runId: 'run-1',
      startedAt: new Date('2026-04-22T10:00:00Z'),
      outcome: 'success',
      eventsCreated: 0,
      eventsUpdated: 0,
      eventsSkippedLocallyEdited: 0,
      eventsDisappeared: 0,
      errorMessage: null,
      ...overrides,
    };
  }

  // ---- argument validation -------------------------------------------------

  it('returns exit 1 and prints an error when neither flag is provided', async () => {
    const res = await runImportSync({}, deps);
    expect(res.exitCode).toBe(1);
    expect(res.runs).toHaveLength(0);
    expect(stderrLines.some(l => l.includes('exactly one of'))).toBe(true);
  });

  it('returns exit 1 when both flags are provided', async () => {
    const res = await runImportSync(
      { sourceId: 'src-1', calendarId: 'cal-1' },
      deps,
    );
    expect(res.exitCode).toBe(1);
    expect(stderrLines.some(l => l.includes('exactly one of'))).toBe(true);
  });

  // ---- single-source path --------------------------------------------------

  it('syncs a single source and prints a summary on success', async () => {
    sandbox.stub(ImportSourceEntity, 'findByPk').resolves({
      id: 'src-1',
      calendar_id: 'cal-1',
    } as unknown as ImportSourceEntity);

    (syncService.syncSource as sinon.SinonStub).resolves(
      makeResult({
        outcome: 'success',
        eventsCreated: 3,
        eventsUpdated: 2,
        eventsSkippedLocallyEdited: 1,
      }),
    );

    const res = await runImportSync({ sourceId: 'src-1' }, deps);

    expect(res.exitCode).toBe(0);
    expect(res.runs).toHaveLength(1);
    expect(stdoutLines).toHaveLength(1);
    expect(stdoutLines[0]).toContain('source=src-1');
    expect(stdoutLines[0]).toContain('created=3');
    expect(stdoutLines[0]).toContain('updated=2');
    expect(stdoutLines[0]).toContain('skipped=1');
    expect(stdoutLines[0]).toContain('outcome=success');
    expect(stderrLines).toHaveLength(0);
  });

  it('treats no_changes as a success outcome (exit 0)', async () => {
    sandbox.stub(ImportSourceEntity, 'findByPk').resolves({
      id: 'src-1',
      calendar_id: 'cal-1',
    } as unknown as ImportSourceEntity);

    (syncService.syncSource as sinon.SinonStub).resolves(
      makeResult({ outcome: 'no_changes' }),
    );

    const res = await runImportSync({ sourceId: 'src-1' }, deps);

    expect(res.exitCode).toBe(0);
    expect(stdoutLines[0]).toContain('outcome=no_changes');
    expect(stderrLines).toHaveLength(0);
  });

  it('exits 1 and prints a sanitized error on fetch_error outcome', async () => {
    sandbox.stub(ImportSourceEntity, 'findByPk').resolves({
      id: 'src-1',
      calendar_id: 'cal-1',
    } as unknown as ImportSourceEntity);

    (syncService.syncSource as sinon.SinonStub).resolves(
      makeResult({
        outcome: 'fetch_error',
        errorMessage: 'IMPORT_FETCH_ERROR',
      }),
    );

    const res = await runImportSync({ sourceId: 'src-1' }, deps);

    expect(res.exitCode).toBe(1);
    // Summary still prints to stdout so operators can see counts.
    expect(stdoutLines[0]).toContain('outcome=fetch_error');
    // Sanitized code — never the raw error message contents.
    expect(stderrLines).toHaveLength(1);
    expect(stderrLines[0]).toContain('IMPORT_FETCH_ERROR');
    expect(stderrLines[0]).toContain('source=src-1');
  });

  it('exits 1 when source is not found (no stdout line)', async () => {
    sandbox.stub(ImportSourceEntity, 'findByPk').resolves(null);

    const res = await runImportSync({ sourceId: 'missing' }, deps);

    expect(res.exitCode).toBe(1);
    expect(res.runs).toHaveLength(0);
    expect(stdoutLines).toHaveLength(0);
    expect(stderrLines.some(l => l.includes('import source not found'))).toBe(true);
  });

  it('sanitizes thrown errors from the sync service', async () => {
    sandbox.stub(ImportSourceEntity, 'findByPk').resolves({
      id: 'src-1',
      calendar_id: 'cal-1',
    } as unknown as ImportSourceEntity);

    (syncService.syncSource as sinon.SinonStub).rejects(
      new ImportSourceVerifyRateLimitError(),
    );

    const res = await runImportSync({ sourceId: 'src-1' }, deps);

    expect(res.exitCode).toBe(1);
    expect(stderrLines).toHaveLength(1);
    expect(stderrLines[0]).toContain('IMPORT_RATE_LIMITED');
    // Must NOT contain the raw error message body (which might include
    // internal identifiers). Only the stable sanitized code.
    expect(stderrLines[0]).not.toContain('stack');
  });

  it('maps ImportSourceNotFoundError thrown from sync to a stable code', async () => {
    sandbox.stub(ImportSourceEntity, 'findByPk').resolves({
      id: 'src-1',
      calendar_id: 'cal-1',
    } as unknown as ImportSourceEntity);

    (syncService.syncSource as sinon.SinonStub).rejects(
      new ImportSourceNotFoundError(),
    );

    const res = await runImportSync({ sourceId: 'src-1' }, deps);

    expect(res.exitCode).toBe(1);
    expect(stderrLines[0]).toContain('IMPORT_SOURCE_NOT_FOUND');
  });

  // ---- calendar-scoped path ------------------------------------------------

  it('enumerates verified sources for a calendar and syncs each', async () => {
    sandbox.stub(ImportSourceEntity, 'findAll').resolves([
      { id: 'src-a', calendar_id: 'cal-1' },
      { id: 'src-b', calendar_id: 'cal-1' },
    ] as unknown as ImportSourceEntity[]);

    const stub = syncService.syncSource as sinon.SinonStub;
    stub
      .onFirstCall().resolves(makeResult({ outcome: 'success', eventsCreated: 1 }))
      .onSecondCall().resolves(makeResult({ outcome: 'no_changes' }));

    const res = await runImportSync({ calendarId: 'cal-1' }, deps);

    expect(res.exitCode).toBe(0);
    expect(res.runs).toHaveLength(2);
    expect(stdoutLines).toHaveLength(2);
    expect(stdoutLines[0]).toContain('source=src-a');
    expect(stdoutLines[0]).toContain('created=1');
    expect(stdoutLines[1]).toContain('source=src-b');
    expect(stdoutLines[1]).toContain('outcome=no_changes');
    expect(stderrLines).toHaveLength(0);
  });

  it('returns exit 1 if any source in a calendar batch fails', async () => {
    sandbox.stub(ImportSourceEntity, 'findAll').resolves([
      { id: 'src-a', calendar_id: 'cal-1' },
      { id: 'src-b', calendar_id: 'cal-1' },
    ] as unknown as ImportSourceEntity[]);

    const stub = syncService.syncSource as sinon.SinonStub;
    stub
      .onFirstCall().resolves(makeResult({ outcome: 'success' }))
      .onSecondCall().resolves(makeResult({
        outcome: 'parse_error',
        errorMessage: 'IMPORT_PARSE_ERROR',
      }));

    const res = await runImportSync({ calendarId: 'cal-1' }, deps);

    expect(res.exitCode).toBe(1);
    expect(stdoutLines).toHaveLength(2);
    expect(stderrLines).toHaveLength(1);
    expect(stderrLines[0]).toContain('source=src-b');
    expect(stderrLines[0]).toContain('IMPORT_PARSE_ERROR');
  });

  it('prints a no-op message and exits 0 when no verified sources exist', async () => {
    sandbox.stub(ImportSourceEntity, 'findAll').resolves([] as unknown as ImportSourceEntity[]);

    const res = await runImportSync({ calendarId: 'cal-1' }, deps);

    expect(res.exitCode).toBe(0);
    expect(res.runs).toHaveLength(0);
    expect(stdoutLines[0]).toContain('no verified sources');
    expect(stderrLines).toHaveLength(0);
    // Sync service must not be invoked when there's nothing to sync.
    expect((syncService.syncSource as sinon.SinonStub).called).toBe(false);
  });

  // ---- owner resolution ----------------------------------------------------

  it('exits 1 when the calendar owner cannot be resolved', async () => {
    sandbox.stub(ImportSourceEntity, 'findByPk').resolves({
      id: 'src-1',
      calendar_id: 'cal-1',
    } as unknown as ImportSourceEntity);

    (calendarOwnerResolver.getCalendarOwnerAccountId as sinon.SinonStub).resolves(null);

    const res = await runImportSync({ sourceId: 'src-1' }, deps);

    expect(res.exitCode).toBe(1);
    expect(stderrLines.some(l => l.includes('calendar owner not found'))).toBe(true);
    expect((syncService.syncSource as sinon.SinonStub).called).toBe(false);
  });

  it('exits 1 when the calendar owner account is missing', async () => {
    sandbox.stub(ImportSourceEntity, 'findByPk').resolves({
      id: 'src-1',
      calendar_id: 'cal-1',
    } as unknown as ImportSourceEntity);

    (accountResolver.getAccountById as sinon.SinonStub).resolves(undefined);

    const res = await runImportSync({ sourceId: 'src-1' }, deps);

    expect(res.exitCode).toBe(1);
    expect(stderrLines.some(l => l.includes('calendar owner account not found'))).toBe(true);
    expect((syncService.syncSource as sinon.SinonStub).called).toBe(false);
  });
});
