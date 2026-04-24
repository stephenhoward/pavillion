import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the ip-validation helper so tests can control SSRF outcomes without
// performing any real DNS lookups.
vi.mock('@/server/common/helper/ip-validation', () => ({
  validateUrlNotPrivate: vi.fn().mockResolvedValue(true),
  isPrivateIP: vi.fn().mockReturnValue(false),
}));
import { validateUrlNotPrivate } from '@/server/common/helper/ip-validation';

import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { ImportSource } from '@/common/model/import_source';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import {
  ImportSourceNotFoundError,
  ImportSourceDnsVerificationError,
  IMPORT_DNS_NOT_FOUND,
} from '@/common/exceptions/import';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';
import ImportSourceService from '@/server/calendar/service/import/import_source_service';
import CalendarService from '@/server/calendar/service/calendar';
import { generateVerificationToken } from '@/server/calendar/service/import/hmac';
import type { DnsVerifier } from '@/server/calendar/service/import/dns-verifier';
import type SyncService from '@/server/calendar/service/import/sync';
import type { SyncResult } from '@/server/calendar/service/import/sync';

/**
 * Unit tests for ImportSourceService (pv-1qcp.1.4).
 *
 * All DB access is stubbed via sinon. Permission checks are exercised
 * through a stubbed CalendarService so we never hit real entities.
 */
describe('ImportSourceService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ImportSourceService;
  let calendarService: sinon.SinonStubbedInstance<CalendarService>;
  let account: Account;
  let calendar: Calendar;

  const CAL_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const SOURCE_ID = 'ssssssss-ssss-ssss-ssss-ssssssssssss';
  const VALID_URL = 'https://events.example.com/calendar.ics';

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    vi.mocked(validateUrlNotPrivate).mockClear();
    vi.mocked(validateUrlNotPrivate).mockResolvedValue(true);

    account = new Account('account-uuid');
    account.email = 'owner@example.com';

    calendar = new Calendar(CAL_ID, 'test-calendar');

    // Stub the CalendarService dependency so we control permission outcomes
    // without touching DB.
    calendarService = sandbox.createStubInstance(CalendarService);
    calendarService.getCalendar.resolves(calendar);
    calendarService.userCanModifyCalendar.resolves(true);

    service = new ImportSourceService(calendarService as unknown as CalendarService);
  });

  afterEach(() => {
    sandbox.restore();
  });

  // --------------------------------------------------------------------
  // createSource
  // --------------------------------------------------------------------

  describe('createSource', () => {
    it('creates a source in verification_state=pending with an HMAC token', async () => {
      sandbox.stub(ImportSourceEntity, 'count').resolves(0);
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(null);

      const savedEntities: ImportSourceEntity[] = [];
      const buildSpy = sandbox.stub(ImportSourceEntity, 'build').callsFake((values) => {
        const fake = {
          id: (values as any).id,
          calendar_id: (values as any).calendar_id,
          url: (values as any).url,
          enabled: (values as any).enabled,
          verification_state: (values as any).verification_state,
          verification_token: (values as any).verification_token,
          verified_at: null,
          verification_expires_at: null,
          etag: null,
          content_hash: null,
          last_fetched_at: null,
          last_status: null,
          created_at: new Date(),
          updated_at: new Date(),
          save: sandbox.stub().resolves(),
          toModel: function() {
            return ImportSourceEntity.prototype.toModel.call(this);
          },
        } as unknown as ImportSourceEntity;
        savedEntities.push(fake);
        return fake;
      });

      const result = await service.createSource(account, CAL_ID, VALID_URL);

      expect(buildSpy.calledOnce).toBe(true);
      const buildArgs = buildSpy.firstCall.args[0] as any;
      expect(buildArgs.calendar_id).toBe(CAL_ID);
      expect(buildArgs.url).toBe(VALID_URL);
      expect(buildArgs.verification_state).toBe('pending');
      expect(buildArgs.verification_token).toBeTruthy();

      // Token was derived by the HMAC helper for this (sourceId, calendarId).
      // We assert against the helper's deterministic output rather than
      // re-testing the HMAC derivation itself.
      const expectedToken = generateVerificationToken(buildArgs.id, CAL_ID);
      expect(buildArgs.verification_token).toBe(expectedToken);

      expect(savedEntities[0].save).toBeDefined();
      expect((savedEntities[0].save as any).calledOnce).toBe(true);

      expect(result.calendarId).toBe(CAL_ID);
      expect(result.url).toBe(VALID_URL);
      expect(result.verificationState).toBe('pending');
      // Token must never leak onto the returned model.
      expect((result as any).verificationToken).toBeUndefined();
    });

    it('rejects when the account lacks edit access (CalendarEditorPermissionError)', async () => {
      calendarService.userCanModifyCalendar.resolves(false);

      await expect(
        service.createSource(account, CAL_ID, VALID_URL),
      ).rejects.toBeInstanceOf(CalendarEditorPermissionError);
    });

    it('rejects when the calendar does not exist (CalendarNotFoundError)', async () => {
      calendarService.getCalendar.resolves(null);

      await expect(
        service.createSource(account, CAL_ID, VALID_URL),
      ).rejects.toBeInstanceOf(CalendarNotFoundError);
    });

    it('throws ValidationError when URL is empty', async () => {
      await expect(
        service.createSource(account, CAL_ID, ''),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws ValidationError when URL is malformed', async () => {
      await expect(
        service.createSource(account, CAL_ID, 'not a url'),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws ValidationError when URL scheme is not http/https', async () => {
      await expect(
        service.createSource(account, CAL_ID, 'ftp://example.com/cal.ics'),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when URL contains embedded credentials', async () => {
      await expect(
        service.createSource(account, CAL_ID, 'https://user:pass@example.com/cal.ics'),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when URL fails SSRF checks (private host)', async () => {
      vi.mocked(validateUrlNotPrivate).mockRejectedValueOnce(
        new Error('Access to private IP address 10.0.0.1 is not allowed'),
      );

      await expect(
        service.createSource(account, CAL_ID, VALID_URL),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    // pv-gdqp: assertUrlIsPublic routes through a gate-aware validator.
    // When an explicit validator is injected via the constructor, the
    // default gate-aware wrapper is bypassed — this is the seam used by
    // production wiring to honor ALLOW_LOCALHOST_ICS_IMPORT without
    // relaxing the shared `validateUrlNotPrivate` helper.
    describe('validateUrl DI seam for ALLOW_LOCALHOST_ICS_IMPORT gate (pv-gdqp)', () => {
      it('uses the injected validator instead of validateUrlNotPrivate', async () => {
        sandbox.stub(ImportSourceEntity, 'count').resolves(0);
        sandbox.stub(ImportSourceEntity, 'findOne').resolves(null);
        sandbox.stub(ImportSourceEntity, 'build').callsFake((values) => ({
          id: (values as any).id,
          calendar_id: (values as any).calendar_id,
          url: (values as any).url,
          verification_state: 'pending',
          verification_token: (values as any).verification_token,
          verified_at: null,
          verification_expires_at: null,
          etag: null,
          content_hash: null,
          last_fetched_at: null,
          last_status: null,
          created_at: new Date(),
          updated_at: new Date(),
          save: sandbox.stub().resolves(),
          toModel: function() { return ImportSourceEntity.prototype.toModel.call(this); },
        } as unknown as ImportSourceEntity));

        let injectedCalls = 0;
        const injectedValidator = async (_url: string): Promise<boolean> => {
          injectedCalls += 1;
          return true;
        };
        const wiredService = new ImportSourceService(
          calendarService as unknown as CalendarService,
          undefined,
          undefined,
          injectedValidator,
        );

        // Use an http://127.0.0.1 URL that the strict default would reject.
        await wiredService.createSource(account, CAL_ID, 'http://127.0.0.1:3000/cal.ics');

        expect(injectedCalls).toBe(1);
        // Crucially, the real validateUrlNotPrivate was NOT called because
        // the injected validator replaced the default gate-aware wrapper.
        expect(vi.mocked(validateUrlNotPrivate)).not.toHaveBeenCalled();
      });

      it('propagates injected validator rejection as ValidationError', async () => {
        const injectedValidator = async (_url: string): Promise<boolean> => {
          throw new Error('injected validator rejected');
        };
        const wiredService = new ImportSourceService(
          calendarService as unknown as CalendarService,
          undefined,
          undefined,
          injectedValidator,
        );

        await expect(
          wiredService.createSource(account, CAL_ID, VALID_URL),
        ).rejects.toBeInstanceOf(ValidationError);
      });
    });

    it('enforces the 10-source-per-calendar cap (11th create throws)', async () => {
      sandbox.stub(ImportSourceEntity, 'count').resolves(10);

      await expect(
        service.createSource(account, CAL_ID, VALID_URL),
      ).rejects.toThrow(/maximum of 10 import sources/);
    });

    it('rejects duplicate URL on the same calendar', async () => {
      sandbox.stub(ImportSourceEntity, 'count').resolves(2);
      // findOne returns an existing row for the duplicate check
      sandbox.stub(ImportSourceEntity, 'findOne').resolves({ id: 'existing' } as any);

      await expect(
        service.createSource(account, CAL_ID, VALID_URL),
      ).rejects.toThrow(/already exists/);
    });
  });

  // --------------------------------------------------------------------
  // listSources
  // --------------------------------------------------------------------

  describe('listSources', () => {
    it('returns all sources for a calendar', async () => {
      const mockEntities = [
        {
          toModel: () => new ImportSource('a', CAL_ID, 'https://a.example.com/a.ics'),
        },
        {
          toModel: () => new ImportSource('b', CAL_ID, 'https://b.example.com/b.ics'),
        },
      ];
      const findAllStub = sandbox.stub(ImportSourceEntity, 'findAll').resolves(mockEntities as any);

      const result = await service.listSources(account, CAL_ID);

      expect(result).toHaveLength(2);
      expect(findAllStub.calledOnce).toBe(true);
      const where = (findAllStub.firstCall.args[0] as any).where;
      expect(where).toEqual({ calendar_id: CAL_ID });
    });

    it('rejects when the account lacks edit access', async () => {
      calendarService.userCanModifyCalendar.resolves(false);

      await expect(service.listSources(account, CAL_ID)).rejects.toBeInstanceOf(
        CalendarEditorPermissionError,
      );
    });
  });

  // --------------------------------------------------------------------
  // getSource
  // --------------------------------------------------------------------

  describe('getSource', () => {
    it('returns the requested source', async () => {
      sandbox.stub(ImportSourceEntity, 'findOne').resolves({
        toModel: () => new ImportSource(SOURCE_ID, CAL_ID, VALID_URL),
      } as any);

      const result = await service.getSource(account, CAL_ID, SOURCE_ID);

      expect(result.id).toBe(SOURCE_ID);
      expect(result.calendarId).toBe(CAL_ID);
    });

    it('throws ImportSourceNotFoundError when the source does not exist', async () => {
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(null);

      await expect(
        service.getSource(account, CAL_ID, SOURCE_ID),
      ).rejects.toBeInstanceOf(ImportSourceNotFoundError);
    });

    it('throws ImportSourceNotFoundError when the source belongs to a different calendar', async () => {
      // findOne is scoped by (id, calendar_id) so a mismatched calendar_id
      // returns null, which surfaces as not-found.
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(null);

      await expect(
        service.getSource(account, CAL_ID, SOURCE_ID),
      ).rejects.toBeInstanceOf(ImportSourceNotFoundError);
    });

    it('rejects when the account lacks edit access', async () => {
      calendarService.userCanModifyCalendar.resolves(false);

      await expect(
        service.getSource(account, CAL_ID, SOURCE_ID),
      ).rejects.toBeInstanceOf(CalendarEditorPermissionError);
    });
  });

  // --------------------------------------------------------------------
  // deleteSource
  // --------------------------------------------------------------------

  describe('deleteSource', () => {
    it('destroys the entity (DB cascade handles import_run + event.import_source_id)', async () => {
      const destroyStub = sandbox.stub().resolves();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves({
        id: SOURCE_ID,
        calendar_id: CAL_ID,
        destroy: destroyStub,
      } as any);

      await service.deleteSource(account, CAL_ID, SOURCE_ID);

      expect(destroyStub.calledOnce).toBe(true);
    });

    it('throws ImportSourceNotFoundError when the source does not exist', async () => {
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(null);

      await expect(
        service.deleteSource(account, CAL_ID, SOURCE_ID),
      ).rejects.toBeInstanceOf(ImportSourceNotFoundError);
    });

    it('rejects when the account lacks edit access', async () => {
      calendarService.userCanModifyCalendar.resolves(false);

      await expect(
        service.deleteSource(account, CAL_ID, SOURCE_ID),
      ).rejects.toBeInstanceOf(CalendarEditorPermissionError);
    });
  });

  // --------------------------------------------------------------------
  // issueVerificationChallenge
  // --------------------------------------------------------------------

  describe('issueVerificationChallenge', () => {
    /**
     * Build a fake ImportSourceEntity shim with a working `save()` spy and
     * the fields the service mutates. Mirrors the pattern used by createSource
     * tests so we never touch a real DB.
     */
    function fakeSourceEntity(overrides: Partial<ImportSourceEntity> = {}): ImportSourceEntity {
      return {
        id: SOURCE_ID,
        calendar_id: CAL_ID,
        url: VALID_URL,
        verification_state: 'unverified',
        verification_token: null,
        save: sandbox.stub().resolves(),
        ...overrides,
      } as unknown as ImportSourceEntity;
    }

    it('transitions unverified → pending and returns the deterministic HMAC token', async () => {
      const entity = fakeSourceEntity({ verification_state: 'unverified' });
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      const token = await service.issueVerificationChallenge(account, CAL_ID, SOURCE_ID);

      const expected = generateVerificationToken(SOURCE_ID, CAL_ID);
      expect(token).toBe(expected);
      // State transition: unverified → pending, and token persisted on entity.
      expect(entity.verification_state).toBe('pending');
      expect(entity.verification_token).toBe(expected);
      expect((entity.save as sinon.SinonStub).calledOnce).toBe(true);
    });

    it('leaves already-pending / verified state untouched but still re-derives the token', async () => {
      const entity = fakeSourceEntity({ verification_state: 'verified' });
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      const token = await service.issueVerificationChallenge(account, CAL_ID, SOURCE_ID);

      expect(token).toBe(generateVerificationToken(SOURCE_ID, CAL_ID));
      // State must NOT be downgraded to 'pending' from 'verified'.
      expect(entity.verification_state).toBe('verified');
      expect(entity.verification_token).toBe(token);
      expect((entity.save as sinon.SinonStub).calledOnce).toBe(true);
    });

    it('returns the same token on repeated calls (determinism contract)', async () => {
      const entity1 = fakeSourceEntity();
      const entity2 = fakeSourceEntity();
      const findOneStub = sandbox.stub(ImportSourceEntity, 'findOne');
      findOneStub.onFirstCall().resolves(entity1);
      findOneStub.onSecondCall().resolves(entity2);

      const token1 = await service.issueVerificationChallenge(account, CAL_ID, SOURCE_ID);
      const token2 = await service.issueVerificationChallenge(account, CAL_ID, SOURCE_ID);

      expect(token1).toBe(token2);
    });

    it('throws ImportSourceNotFoundError when the source does not exist', async () => {
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(null);

      await expect(
        service.issueVerificationChallenge(account, CAL_ID, SOURCE_ID),
      ).rejects.toBeInstanceOf(ImportSourceNotFoundError);
    });

    it('rejects when the account lacks edit access (CalendarEditorPermissionError)', async () => {
      calendarService.userCanModifyCalendar.resolves(false);

      await expect(
        service.issueVerificationChallenge(account, CAL_ID, SOURCE_ID),
      ).rejects.toBeInstanceOf(CalendarEditorPermissionError);
    });
  });

  // --------------------------------------------------------------------
  // verifySource
  // --------------------------------------------------------------------

  describe('verifySource', () => {
    function fakeSourceEntity(overrides: Partial<ImportSourceEntity> = {}): ImportSourceEntity {
      return {
        id: SOURCE_ID,
        calendar_id: CAL_ID,
        url: VALID_URL,
        verification_state: 'pending',
        verified_at: null,
        verification_expires_at: null,
        save: sandbox.stub().resolves(),
        toModel: () => {
          const model = new ImportSource(SOURCE_ID, CAL_ID, VALID_URL);
          model.verificationState = 'verified';
          return model;
        },
        ...overrides,
      } as unknown as ImportSourceEntity;
    }

    it('transitions state to verified and stamps verified_at / verification_expires_at on success', async () => {
      const verifiedAt = new Date('2026-04-23T12:00:00Z');
      const expiresAt = new Date('2026-07-22T12:00:00Z');
      const entity = fakeSourceEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      // Inject a fake DnsVerifier so no DNS lookup or HTTP fetch occurs.
      const fakeVerifier = {
        verify: sandbox.stub().resolves({ verified: true, verifiedAt, expiresAt }),
      } as unknown as DnsVerifier;
      service.setDnsVerifier(fakeVerifier);

      const result = await service.verifySource(account, CAL_ID, SOURCE_ID);

      expect(entity.verification_state).toBe('verified');
      expect(entity.verified_at).toBe(verifiedAt);
      expect(entity.verification_expires_at).toBe(expiresAt);
      expect((entity.save as sinon.SinonStub).calledOnce).toBe(true);
      expect(result.verificationState).toBe('verified');
    });

    it('propagates ImportSourceDnsVerificationError from the verifier (no state change)', async () => {
      const entity = fakeSourceEntity({ verification_state: 'pending' });
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      const fakeVerifier = {
        verify: sandbox.stub().rejects(new ImportSourceDnsVerificationError(IMPORT_DNS_NOT_FOUND)),
      } as unknown as DnsVerifier;
      service.setDnsVerifier(fakeVerifier);

      await expect(
        service.verifySource(account, CAL_ID, SOURCE_ID),
      ).rejects.toBeInstanceOf(ImportSourceDnsVerificationError);

      // State untouched so the caller may retry after fixing DNS.
      expect(entity.verification_state).toBe('pending');
      expect((entity.save as sinon.SinonStub).called).toBe(false);
    });

    it('throws ImportSourceNotFoundError when the source does not exist', async () => {
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(null);

      await expect(
        service.verifySource(account, CAL_ID, SOURCE_ID),
      ).rejects.toBeInstanceOf(ImportSourceNotFoundError);
    });

    it('rejects when the account lacks edit access (CalendarEditorPermissionError)', async () => {
      calendarService.userCanModifyCalendar.resolves(false);

      await expect(
        service.verifySource(account, CAL_ID, SOURCE_ID),
      ).rejects.toBeInstanceOf(CalendarEditorPermissionError);
    });
  });

  // --------------------------------------------------------------------
  // syncSource
  // --------------------------------------------------------------------

  describe('syncSource', () => {
    const FAKE_RESULT: SyncResult = {
      runId: 'run-xyz',
      startedAt: new Date('2026-04-22T10:00:00Z'),
      outcome: 'success',
      eventsCreated: 3,
      eventsUpdated: 0,
      eventsSkippedLocallyEdited: 0,
      eventsDisappeared: 0,
      errorMessage: null,
    };

    function fakeSourceEntity(overrides: Partial<ImportSourceEntity> = {}): ImportSourceEntity {
      return {
        id: SOURCE_ID,
        calendar_id: CAL_ID,
        url: VALID_URL,
        verification_state: 'verified',
        save: sandbox.stub().resolves(),
        ...overrides,
      } as unknown as ImportSourceEntity;
    }

    it('delegates to the injected SyncService', async () => {
      const entity = fakeSourceEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      const syncStub = sandbox.stub().resolves(FAKE_RESULT);
      const fakeSyncService = { syncSource: syncStub } as unknown as SyncService;
      const wiredService = new ImportSourceService(
        calendarService as unknown as CalendarService,
        fakeSyncService,
      );

      const result = await wiredService.syncSource(account, CAL_ID, SOURCE_ID);

      expect(result).toBe(FAKE_RESULT);
      expect(syncStub.calledOnce).toBe(true);
      // The orchestrator is called with { account, importSourceId }, never
      // calendarId — the source has already been scoped to the calendar by
      // the service's permission + lookup checks.
      const callArg = syncStub.firstCall.args[0];
      expect(callArg.importSourceId).toBe(SOURCE_ID);
      expect(callArg.account).toBe(account);
    });

    it('throws a guard error when the SyncService is not wired', async () => {
      const entity = fakeSourceEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      // SyncService intentionally NOT wired — production startup must inject
      // one during interface bootstrap. If that wiring is ever skipped we
      // want a loud guard, not a silent null-deref.
      await expect(
        service.syncSource(account, CAL_ID, SOURCE_ID),
      ).rejects.toThrow(/SyncService wiring/);
    });

    it('throws ImportSourceNotFoundError when the source does not exist', async () => {
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(null);

      await expect(
        service.syncSource(account, CAL_ID, SOURCE_ID),
      ).rejects.toBeInstanceOf(ImportSourceNotFoundError);
    });

    it('rejects when the account lacks edit access (CalendarEditorPermissionError)', async () => {
      calendarService.userCanModifyCalendar.resolves(false);

      await expect(
        service.syncSource(account, CAL_ID, SOURCE_ID),
      ).rejects.toBeInstanceOf(CalendarEditorPermissionError);
    });
  });

  // --------------------------------------------------------------------
  // URL immutability
  // --------------------------------------------------------------------

  describe('URL immutability (security-advisor)', () => {
    it('does not expose an update / URL-mutation method on the service', () => {
      // Any change to the source URL must go through delete + recreate so
      // that verification is re-run. Asserting the public surface keeps
      // this contract from silently regressing.
      const svc = service as unknown as Record<string, unknown>;
      expect(typeof svc.updateSource).toBe('undefined');
      expect(typeof svc.updateSourceUrl).toBe('undefined');
      expect(typeof svc.setUrl).toBe('undefined');
    });
  });
});
