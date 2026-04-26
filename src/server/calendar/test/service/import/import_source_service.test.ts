import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the ip-validation helper so tests can control SSRF outcomes without
// performing any real DNS lookups.
vi.mock('@/server/common/helper/ip-validation', () => ({
  validateUrlNotPrivate: vi.fn().mockResolvedValue(true),
  isPrivateIP: vi.fn().mockReturnValue(false),
}));
import { validateUrlNotPrivate } from '@/server/common/helper/ip-validation';

// Wrap cheerio in a partial mock so tests can opt into a throwing `load`
// for the rel-me PARSE_ERROR branch. Defaults to the real implementation
// so every other test parses HTML normally.
const cheerioLoadShouldThrow = { current: false };
vi.mock('cheerio', async () => {
  const actual = await vi.importActual<typeof import('cheerio')>('cheerio');
  return {
    ...actual,
    load: ((html: string, ...rest: unknown[]) => {
      if (cheerioLoadShouldThrow.current) {
        throw new Error('forced cheerio failure');
      }
      return (actual.load as unknown as (...args: unknown[]) => unknown)(html, ...rest);
    }) as typeof actual.load,
  };
});

import sinon from 'sinon';
import config from 'config';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { ImportSource } from '@/common/model/import_source';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import {
  ImportSourceNotFoundError,
  ImportSourceDnsVerificationError,
  ImportSourceRelMeVerificationError,
  ImportSourceSsrfBlockedError,
  IMPORT_DNS_NOT_FOUND,
  IMPORT_RELME_HOSTNAME_MISMATCH,
  IMPORT_RELME_LINK_NOT_FOUND,
  IMPORT_RELME_PAGE_FETCH_ERROR,
  IMPORT_RELME_PARSE_ERROR,
  IMPORT_RELME_PSL_VIOLATION,
} from '@/common/exceptions/import';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';
import ImportSourceService, {
  HtmlFetcher,
  HtmlFetchResult,
} from '@/server/calendar/service/import/import_source_service';
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
          verification_type: (values as any).verification_type,
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
      // The service stamps the discriminator explicitly even though the DB
      // default would cover it, so future call paths that create sources
      // with a different type (OAuth onboarding) have a clear precedent.
      // See bead pv-44qj.
      expect(buildArgs.verification_type).toBe('dns-txt');
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
      expect(result.verificationType).toBe('dns-txt');
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

    it('accepts a scheme-less URL by defaulting to https://', async () => {
      sandbox.stub(ImportSourceEntity, 'count').resolves(0);
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(null);

      const savedEntities: ImportSourceEntity[] = [];
      const buildSpy = sandbox.stub(ImportSourceEntity, 'build').callsFake((values) => {
        const fake = {
          id: (values as any).id,
          calendar_id: (values as any).calendar_id,
          url: (values as any).url,
          enabled: (values as any).enabled,
          verification_type: (values as any).verification_type,
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

      const result = await service.createSource(
        account,
        CAL_ID,
        'events.example.com/calendar.ics',
      );

      expect(buildSpy.calledOnce).toBe(true);
      const buildArgs = buildSpy.firstCall.args[0] as any;
      expect(buildArgs.url).toBe('https://events.example.com/calendar.ics');
      expect(result.url).toBe('https://events.example.com/calendar.ics');
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
    it('destroys the entity (DB cascade handles import_run + event_import_origin rows)', async () => {
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
        // Default the discriminator to 'dns-txt' so fixtures mirror what
        // the DB default produces for pre-existing rows. The
        // issueVerificationChallenge contract preserves the persisted type
        // when the caller does not request a change.
        verification_type: 'dns-txt',
        verification_state: 'unverified',
        verification_token: null,
        verified_at: null,
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
      // Discriminator preserved when caller does not request a change.
      // See bead pv-jutm.3.1: only an explicit verification_type triggers a
      // type swap (and `verified_at` clear).
      expect(entity.verification_type).toBe('dns-txt');
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
      expect(entity.verification_type).toBe('dns-txt');
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

    it('persists the requested verification_type when caller passes "rel-me"', async () => {
      const entity = fakeSourceEntity({
        verification_state: 'pending',
        verification_type: 'dns-txt',
        verified_at: new Date('2026-01-01T00:00:00Z'),
      });
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      await service.issueVerificationChallenge(account, CAL_ID, SOURCE_ID, 'rel-me');

      expect(entity.verification_type).toBe('rel-me');
      // Switching the verification_type invalidates the previous proof —
      // verifiedAt must be cleared so the source re-enters the verify gate.
      expect(entity.verified_at).toBeNull();
    });

    it('clears verifiedAt only when verification_type actually changes', async () => {
      const verifiedAt = new Date('2026-01-01T00:00:00Z');
      const entity = fakeSourceEntity({
        verification_state: 'verified',
        verification_type: 'dns-txt',
        verified_at: verifiedAt,
      });
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      await service.issueVerificationChallenge(account, CAL_ID, SOURCE_ID, 'dns-txt');

      // Type unchanged — verifiedAt must be preserved.
      expect(entity.verification_type).toBe('dns-txt');
      expect(entity.verified_at).toBe(verifiedAt);
    });

    it('defaults to dns-txt when no verification_type is passed', async () => {
      const entity = fakeSourceEntity({
        verification_state: 'unverified',
        verification_type: 'dns-txt',
      });
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      await service.issueVerificationChallenge(account, CAL_ID, SOURCE_ID);

      expect(entity.verification_type).toBe('dns-txt');
    });

    it('rejects unknown verification_type values with ValidationError', async () => {
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(fakeSourceEntity());

      await expect(
        service.issueVerificationChallenge(
          account,
          CAL_ID,
          SOURCE_ID,
          'bogus' as unknown as 'dns-txt',
        ),
      ).rejects.toBeInstanceOf(ValidationError);
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
        verification_type: 'dns-txt',
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

  // --------------------------------------------------------------------
  // verifyRelMeSource (pv-jutm.2 — rel-me ownership verification)
  // --------------------------------------------------------------------

  /**
   * Tests for the rel="me" verification branch of `verifySource`. The
   * dispatcher routes to the rel-me path when the entity carries
   * `verification_type: 'rel-me'`. All HTML fetching is replaced with a
   * stub `HtmlFetcher` so no real network or DNS calls happen here.
   *
   * The expected backlink URL is computed by the verifier from
   * `${https://${config.domain}}/.well-known/pavillion-verify/${token}`.
   * In tests, `config.domain` is `pavillion.dev` and the HMAC token is
   * deterministic for a given (sourceId, calendarId), so we can derive
   * the exact href the verifier will look for.
   */
  describe('verifyRelMeSource', () => {
    // Source URL for rel-me sources: hostname determines what the
    // verification page hostname must equal. We pick a registrable
    // domain (PSL-safe) so the PSL guard does not interfere unless we
    // explicitly probe it.
    const RELME_SOURCE_URL = 'https://events.example.org/calendar.ics';
    const RELME_PAGE_URL = 'https://events.example.org/about';

    /**
     * Build a fake ImportSourceEntity scoped to the rel-me branch, with a
     * `save()` spy and `toModel()` shim mirroring the real entity contract.
     */
    function fakeRelMeEntity(
      overrides: Partial<ImportSourceEntity> = {},
    ): ImportSourceEntity {
      return {
        id: SOURCE_ID,
        calendar_id: CAL_ID,
        url: RELME_SOURCE_URL,
        verification_type: 'rel-me',
        verification_state: 'pending',
        verified_at: null,
        verification_expires_at: null,
        save: sandbox.stub().resolves(),
        toModel: () => {
          const model = new ImportSource(SOURCE_ID, CAL_ID, RELME_SOURCE_URL);
          model.verificationState = 'verified';
          return model;
        },
        ...overrides,
      } as unknown as ImportSourceEntity;
    }

    /**
     * Compute the expected `<a rel="me" href="...">` URL the verifier will
     * look for on the verification page. Mirrors the production formula:
     *   `https://${config.domain}/.well-known/pavillion-verify/${token}`
     *
     * Reads `config.get('domain')` at call time so the test honors whatever
     * the test environment resolves (test.yaml vs local.yaml overrides).
     */
    function expectedRelMeHref(): string {
      const token = generateVerificationToken(SOURCE_ID, CAL_ID);
      const instanceHost = config.get<string>('domain');
      // Match the verifier's canonicalization: passing the URL through
      // `new URL().toString()` so default-port and trailing-slash
      // normalization match the comparison the verifier performs.
      return new URL(`https://${instanceHost}/.well-known/pavillion-verify/${token}`).toString();
    }

    /**
     * Build a stub HtmlFetcher that returns the supplied body. `calls`
     * accumulates each invoked URL so tests can assert call counts and
     * fast-fail paths.
     */
    function makeFetcher(
      body: string,
      calls: string[] = [],
    ): { fetcher: HtmlFetcher; calls: string[] } {
      const fetcher: HtmlFetcher = {
        fetch: async (url: string): Promise<HtmlFetchResult> => {
          calls.push(url);
          return {
            status: 200,
            body: Buffer.from(body, 'utf8'),
            finalUrl: url,
          };
        },
      };
      return { fetcher, calls };
    }

    /**
     * Build a stub HtmlFetcher whose fetch() throws. Used for transport
     * failure / SSRF / size-cap branches.
     */
    function makeFetcherThatThrows(
      err: Error,
      calls: string[] = [],
    ): { fetcher: HtmlFetcher; calls: string[] } {
      const fetcher: HtmlFetcher = {
        fetch: async (url: string): Promise<HtmlFetchResult> => {
          calls.push(url);
          throw err;
        },
      };
      return { fetcher, calls };
    }

    // -------------------------------------------------------------
    // Happy paths
    // -------------------------------------------------------------

    it('verifies on a matching <a rel="me" href> backlink', async () => {
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      const href = expectedRelMeHref();
      const html = `<!doctype html><html><head></head><body>
        <a rel="me" href="${href}">Pavillion calendar</a>
      </body></html>`;
      const { fetcher, calls } = makeFetcher(html);
      service.setHtmlFetcher(fetcher);

      const result = await service.verifySource(account, CAL_ID, SOURCE_ID, RELME_PAGE_URL);

      expect(calls).toEqual([RELME_PAGE_URL]);
      expect(entity.verification_state).toBe('verified');
      expect(entity.verified_at).toBeInstanceOf(Date);
      expect(entity.verification_expires_at).toBeInstanceOf(Date);
      // 90-day window: verified_at + 90d == verification_expires_at
      const verifiedAt = entity.verified_at as Date;
      const expiresAt = entity.verification_expires_at as Date;
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
      expect(expiresAt.getTime() - verifiedAt.getTime()).toBe(ninetyDaysMs);
      expect((entity.save as sinon.SinonStub).calledOnce).toBe(true);
      expect(result.verificationState).toBe('verified');
    });

    it('verifies on a matching <link rel="me" href> backlink', async () => {
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      const href = expectedRelMeHref();
      // <link rel="me"> typically lives in <head>. The verifier accepts
      // either `<a>` or `<link>` carriers.
      const html = `<!doctype html><html><head>
        <link rel="me" href="${href}">
      </head><body></body></html>`;
      const { fetcher } = makeFetcher(html);
      service.setHtmlFetcher(fetcher);

      const result = await service.verifySource(account, CAL_ID, SOURCE_ID, RELME_PAGE_URL);

      expect(entity.verification_state).toBe('verified');
      expect(result.verificationState).toBe('verified');
      expect((entity.save as sinon.SinonStub).calledOnce).toBe(true);
    });

    it('matches a multi-value rel attribute (rel="me noopener")', async () => {
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      const href = expectedRelMeHref();
      // The verifier must tokenize the rel attribute, not string-equal it.
      const html = `<!doctype html><html><body>
        <a rel="me noopener" href="${href}">My calendar</a>
      </body></html>`;
      const { fetcher } = makeFetcher(html);
      service.setHtmlFetcher(fetcher);

      const result = await service.verifySource(account, CAL_ID, SOURCE_ID, RELME_PAGE_URL);

      expect(entity.verification_state).toBe('verified');
      expect(result.verificationState).toBe('verified');
      expect((entity.save as sinon.SinonStub).calledOnce).toBe(true);
    });

    it('matches when the href attribute appears before rel (reversed attribute order)', async () => {
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      const href = expectedRelMeHref();
      // cheerio normalizes attribute order; this guards against any naive
      // regex-based matcher silently regressing to attribute-order sensitivity.
      const html = `<!doctype html><html><body>
        <a href="${href}" rel="me">Pavillion calendar</a>
      </body></html>`;
      const { fetcher } = makeFetcher(html);
      service.setHtmlFetcher(fetcher);

      const result = await service.verifySource(account, CAL_ID, SOURCE_ID, RELME_PAGE_URL);

      expect(entity.verification_state).toBe('verified');
      expect(result.verificationState).toBe('verified');
      expect((entity.save as sinon.SinonStub).calledOnce).toBe(true);
    });

    // -------------------------------------------------------------
    // Negative branches that DO require a fetch
    // -------------------------------------------------------------

    it('throws IMPORT_RELME_LINK_NOT_FOUND when the rel="me" href targets a different URL', async () => {
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      // The wrong URL: same shape but a different token. This is the false-
      // negative scenario — link present but not pointing at this source.
      const wrongHref
        = 'https://pavillion.dev/.well-known/pavillion-verify/0000000000000000000000000000000000000000000000000000000000000000';
      const html = `<!doctype html><html><body>
        <a rel="me" href="${wrongHref}">Some other calendar</a>
      </body></html>`;
      const { fetcher } = makeFetcher(html);
      service.setHtmlFetcher(fetcher);

      try {
        await service.verifySource(account, CAL_ID, SOURCE_ID, RELME_PAGE_URL);
        expect.fail('expected ImportSourceRelMeVerificationError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceRelMeVerificationError);
        expect((err as ImportSourceRelMeVerificationError).reason).toBe(IMPORT_RELME_LINK_NOT_FOUND);
      }

      // State must NOT transition on failure so the caller may retry.
      expect(entity.verification_state).toBe('pending');
      expect((entity.save as sinon.SinonStub).called).toBe(false);
    });

    it('throws IMPORT_RELME_LINK_NOT_FOUND when the token URL appears as plain text but no rel="me" link', async () => {
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      const href = expectedRelMeHref();
      // The expected URL is mentioned on the page but only as text and as
      // a non-rel-me link; this must NOT count as verification.
      const html = `<!doctype html><html><body>
        <p>To verify, paste this URL: ${href}</p>
        <a href="${href}">Click here (no rel="me")</a>
      </body></html>`;
      const { fetcher } = makeFetcher(html);
      service.setHtmlFetcher(fetcher);

      try {
        await service.verifySource(account, CAL_ID, SOURCE_ID, RELME_PAGE_URL);
        expect.fail('expected ImportSourceRelMeVerificationError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceRelMeVerificationError);
        expect((err as ImportSourceRelMeVerificationError).reason).toBe(IMPORT_RELME_LINK_NOT_FOUND);
      }
    });

    it('throws IMPORT_RELME_PARSE_ERROR when cheerio cannot load the body', async () => {
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      // cheerio is famously tolerant of malformed HTML, so the PARSE_ERROR
      // branch is a defensive catch. The module-level vi.mock for cheerio
      // routes `load()` through a toggle so this single test can force a
      // throw without affecting any other test's HTML parsing.
      cheerioLoadShouldThrow.current = true;
      try {
        const html = '<html><body></body></html>';
        const { fetcher } = makeFetcher(html);
        service.setHtmlFetcher(fetcher);

        try {
          await service.verifySource(account, CAL_ID, SOURCE_ID, RELME_PAGE_URL);
          expect.fail('expected ImportSourceRelMeVerificationError');
        }
        catch (err) {
          expect(err).toBeInstanceOf(ImportSourceRelMeVerificationError);
          expect((err as ImportSourceRelMeVerificationError).reason).toBe(IMPORT_RELME_PARSE_ERROR);
        }

        expect(entity.verification_state).toBe('pending');
        expect((entity.save as sinon.SinonStub).called).toBe(false);
      }
      finally {
        cheerioLoadShouldThrow.current = false;
      }
    });

    // -------------------------------------------------------------
    // SSRF / network failure / size-cap branches
    // -------------------------------------------------------------

    it('propagates ImportSourceSsrfBlockedError from the fetcher unchanged', async () => {
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      const ssrf = new ImportSourceSsrfBlockedError({ reason: 'private_ip_resolved' });
      const { fetcher } = makeFetcherThatThrows(ssrf);
      service.setHtmlFetcher(fetcher);

      await expect(
        service.verifySource(account, CAL_ID, SOURCE_ID, RELME_PAGE_URL),
      ).rejects.toBeInstanceOf(ImportSourceSsrfBlockedError);

      // SSRF leaves the entity untouched.
      expect(entity.verification_state).toBe('pending');
      expect((entity.save as sinon.SinonStub).called).toBe(false);
    });

    it('throws IMPORT_RELME_PAGE_FETCH_ERROR on generic network failure', async () => {
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      const { fetcher } = makeFetcherThatThrows(new Error('ECONNREFUSED'));
      service.setHtmlFetcher(fetcher);

      try {
        await service.verifySource(account, CAL_ID, SOURCE_ID, RELME_PAGE_URL);
        expect.fail('expected ImportSourceRelMeVerificationError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceRelMeVerificationError);
        expect((err as ImportSourceRelMeVerificationError).reason).toBe(IMPORT_RELME_PAGE_FETCH_ERROR);
      }
    });

    it('throws IMPORT_RELME_PAGE_FETCH_ERROR when fetcher reports body cap exceeded', async () => {
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      // The default fetcher signals over-cap by throwing
      // ImportSourceRelMeVerificationError(IMPORT_RELME_PAGE_FETCH_ERROR).
      // From the verifier's perspective this is indistinguishable from any
      // other transport failure — both surface as PAGE_FETCH_ERROR.
      const overCap = new ImportSourceRelMeVerificationError(IMPORT_RELME_PAGE_FETCH_ERROR);
      const { fetcher } = makeFetcherThatThrows(overCap);
      service.setHtmlFetcher(fetcher);

      try {
        await service.verifySource(account, CAL_ID, SOURCE_ID, RELME_PAGE_URL);
        expect.fail('expected ImportSourceRelMeVerificationError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceRelMeVerificationError);
        expect((err as ImportSourceRelMeVerificationError).reason).toBe(IMPORT_RELME_PAGE_FETCH_ERROR);
      }
    });

    // -------------------------------------------------------------
    // Pre-fetch validation (security-critical: assert fetcher NOT called)
    // -------------------------------------------------------------

    it('throws IMPORT_RELME_HOSTNAME_MISMATCH and does NOT call the fetcher when hostnames differ', async () => {
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      // Source URL hostname = events.example.org
      // Page URL hostname    = attacker.example.com
      // Full-hostname equality is required (NOT eTLD+1), so this must
      // bounce before any outbound traffic.
      const calls: string[] = [];
      const fetcher: HtmlFetcher = {
        fetch: async (url: string): Promise<HtmlFetchResult> => {
          calls.push(url);
          return { status: 200, body: Buffer.from(''), finalUrl: url };
        },
      };
      service.setHtmlFetcher(fetcher);

      try {
        await service.verifySource(
          account,
          CAL_ID,
          SOURCE_ID,
          'https://attacker.example.com/about',
        );
        expect.fail('expected ImportSourceRelMeVerificationError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceRelMeVerificationError);
        expect((err as ImportSourceRelMeVerificationError).reason).toBe(IMPORT_RELME_HOSTNAME_MISMATCH);
      }

      // Security-critical: the verifier MUST NOT have issued a fetch for the
      // attacker-controlled hostname. This is the primary defence against
      // the verifier being weaponized as an SSRF probe.
      expect(calls).toEqual([]);
      expect(entity.verification_state).toBe('pending');
      expect((entity.save as sinon.SinonStub).called).toBe(false);
    });

    it('throws IMPORT_RELME_PSL_VIOLATION and does NOT call the fetcher when hostname is at/above the PSL', async () => {
      // Use a source URL whose hostname IS itself a public-suffix entry.
      // `co.uk` is on the PSL, so any source pointed at bare `co.uk` must
      // be rejected before any fetch — the same shared-tenancy attack model
      // the DNS verifier guards against.
      const pslEntity = fakeRelMeEntity({ url: 'https://co.uk/calendar.ics' });
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(pslEntity);

      const calls: string[] = [];
      const fetcher: HtmlFetcher = {
        fetch: async (url: string): Promise<HtmlFetchResult> => {
          calls.push(url);
          return { status: 200, body: Buffer.from(''), finalUrl: url };
        },
      };
      service.setHtmlFetcher(fetcher);

      try {
        await service.verifySource(
          account,
          CAL_ID,
          SOURCE_ID,
          'https://co.uk/about',
        );
        expect.fail('expected ImportSourceRelMeVerificationError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceRelMeVerificationError);
        expect((err as ImportSourceRelMeVerificationError).reason).toBe(IMPORT_RELME_PSL_VIOLATION);
      }

      // Security-critical: PSL-violating hostnames must never trigger an
      // outbound fetch. A multi-tenant host (alice.co.uk vs bob.co.uk)
      // must not be reachable via this verifier.
      expect(calls).toEqual([]);
      expect(pslEntity.verification_state).toBe('pending');
      expect((pslEntity.save as sinon.SinonStub).called).toBe(false);
    });

    // -------------------------------------------------------------
    // Sanitized error surface
    // -------------------------------------------------------------

    it('returns sanitized error messages that contain no raw page content or user-supplied URL', async () => {
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      // Embed a unique sentinel both in the user-supplied URL and in the
      // returned page body. The thrown exception's message must not leak
      // either string.
      const sentinelInUrl = 'sentinel-url-secret-9f3a1';
      const sentinelInBody = 'sentinel-body-secret-c2e7d';
      const html = `<html><body>
        <p>${sentinelInBody}</p>
        <a href="https://elsewhere.example.org/foo">no rel attr</a>
      </body></html>`;
      const { fetcher } = makeFetcher(html);
      service.setHtmlFetcher(fetcher);

      // Page URL must satisfy hostname/PSL constraints so we hit the link-
      // not-found branch (the rel="me" element is missing here).
      const pageUrl = `https://events.example.org/about?q=${sentinelInUrl}`;

      try {
        await service.verifySource(account, CAL_ID, SOURCE_ID, pageUrl);
        expect.fail('expected ImportSourceRelMeVerificationError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ImportSourceRelMeVerificationError);
        const e = err as ImportSourceRelMeVerificationError;
        // Sanitization contract: error.message is the reason code, not a
        // human sentence containing fetched content or URLs.
        expect(e.message).toBe(IMPORT_RELME_LINK_NOT_FOUND);
        expect(e.message).not.toContain(sentinelInBody);
        expect(e.message).not.toContain(sentinelInUrl);
      }
    });

    // -------------------------------------------------------------
    // Dispatcher routing & permission gating
    // -------------------------------------------------------------

    it('routes through verifySource dispatcher when verification_type is "rel-me"', async () => {
      // Sanity check on the dispatcher seam. If the switch in verifySource
      // ever stops routing 'rel-me' to the rel-me path, this test fails
      // because the DNS verifier (still injected) would NOT be exercised.
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      // Wire a DNS verifier that, if accidentally called, would corrupt the
      // outcome — its presence here lets us assert the dispatcher does NOT
      // fall through to the DNS branch for 'rel-me' sources.
      const dnsStub = sandbox.stub().rejects(new ImportSourceDnsVerificationError(IMPORT_DNS_NOT_FOUND));
      service.setDnsVerifier({ verify: dnsStub } as unknown as DnsVerifier);

      const href = expectedRelMeHref();
      const html = `<html><body><a rel="me" href="${href}">x</a></body></html>`;
      const { fetcher } = makeFetcher(html);
      service.setHtmlFetcher(fetcher);

      const result = await service.verifySource(account, CAL_ID, SOURCE_ID, RELME_PAGE_URL);

      expect(dnsStub.called).toBe(false);
      expect(result.verificationState).toBe('verified');
    });

    it('rejects when the account lacks edit access (CalendarEditorPermissionError)', async () => {
      calendarService.userCanModifyCalendar.resolves(false);

      await expect(
        service.verifySource(account, CAL_ID, SOURCE_ID, RELME_PAGE_URL),
      ).rejects.toBeInstanceOf(CalendarEditorPermissionError);
    });

    it('throws ImportSourceNotFoundError when the source does not exist', async () => {
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(null);

      await expect(
        service.verifySource(account, CAL_ID, SOURCE_ID, RELME_PAGE_URL),
      ).rejects.toBeInstanceOf(ImportSourceNotFoundError);
    });

    // -------------------------------------------------------------
    // Verification-page URL validation (ValidationError surface)
    // -------------------------------------------------------------

    it('throws ValidationError when verificationPageUrl is missing', async () => {
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      // No fetcher should ever be called; if it is, the test would fail by
      // returning a verification result instead of a ValidationError.
      const calls: string[] = [];
      const fetcher: HtmlFetcher = {
        fetch: async (url: string) => {
          calls.push(url);
          return { status: 200, body: Buffer.from(''), finalUrl: url };
        },
      };
      service.setHtmlFetcher(fetcher);

      await expect(
        service.verifySource(account, CAL_ID, SOURCE_ID, undefined),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(calls).toEqual([]);
    });

    it('throws ValidationError when verificationPageUrl uses non-https scheme', async () => {
      const entity = fakeRelMeEntity();
      sandbox.stub(ImportSourceEntity, 'findOne').resolves(entity);

      const calls: string[] = [];
      const fetcher: HtmlFetcher = {
        fetch: async (url: string) => {
          calls.push(url);
          return { status: 200, body: Buffer.from(''), finalUrl: url };
        },
      };
      service.setHtmlFetcher(fetcher);

      await expect(
        service.verifySource(
          account,
          CAL_ID,
          SOURCE_ID,
          'http://events.example.org/about',
        ),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(calls).toEqual([]);
    });
  });
});
