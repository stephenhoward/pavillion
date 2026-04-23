import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the ip-validation helper so tests can control SSRF outcomes without
// performing any real DNS lookups.
vi.mock('@/server/common/helper/ip-validation', () => ({
  validateUrlNotPrivate: vi.fn().mockResolvedValue(true),
}));
import { validateUrlNotPrivate } from '@/server/common/helper/ip-validation';

import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { ImportSource } from '@/common/model/import_source';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import { ImportSourceNotFoundError } from '@/common/exceptions/import';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';
import ImportSourceService from '@/server/calendar/service/import/import_source_service';
import CalendarService from '@/server/calendar/service/calendar';
import { generateVerificationToken } from '@/server/calendar/service/import/hmac';

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
