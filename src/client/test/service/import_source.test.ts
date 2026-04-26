import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';

import ImportSourceService from '@/client/service/import_source';
import { ImportSource } from '@/common/model/import_source';
import {
  UnauthenticatedError,
  UnknownError,
} from '@/common/exceptions/base';
import {
  ImportSourceNotFoundError,
  ImportSourceFetchError,
  ImportSourceSsrfBlockedError,
  ImportSourceDnsVerificationError,
  ImportSourceVerifyRateLimitError,
  IMPORT_DNS_NOT_FOUND,
} from '@/common/exceptions/import';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';

// Mock axios so every test starts with fresh stubs
vi.mock('axios');

const CALENDAR_ID = '11111111-1111-1111-1111-111111111111';
const SOURCE_ID = '22222222-2222-2222-2222-222222222222';

/**
 * Build the `.toObject()` wire shape for an ImportSource — matches the
 * payload the server sends over HTTP.
 */
function sourcePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SOURCE_ID,
    calendarId: CALENDAR_ID,
    url: 'https://example.com/feed.ics',
    enabled: true,
    verificationState: 'unverified',
    verifiedAt: null,
    verificationExpiresAt: null,
    etag: null,
    contentHash: null,
    lastFetchedAt: null,
    lastStatus: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

describe('ImportSourceService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ImportSourceService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new ImportSourceService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('listSources', () => {
    it('calls the list endpoint and deserializes into ImportSource[]', async () => {
      const payload = [
        sourcePayload({ url: 'https://example.com/a.ics' }),
        sourcePayload({
          id: '33333333-3333-3333-3333-333333333333',
          url: 'https://example.com/b.ics',
          verificationState: 'verified',
        }),
      ];
      const getStub = sandbox.stub(axios, 'get').resolves({ data: payload });

      const result = await service.listSources(CALENDAR_ID);

      expect(getStub.calledOnce).toBe(true);
      expect(getStub.firstCall.args[0]).toBe(
        `/api/v1/calendars/${CALENDAR_ID}/import-sources`,
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(ImportSource);
      expect(result[0].url).toBe('https://example.com/a.ics');
      expect(result[1].verificationState).toBe('verified');
    });

    it('throws CalendarNotFoundError when server returns that errorName', async () => {
      sandbox.stub(axios, 'get').rejects({
        response: { data: { errorName: 'CalendarNotFoundError' } },
      });

      await expect(service.listSources(CALENDAR_ID)).rejects.toThrow(
        CalendarNotFoundError,
      );
    });

    it('throws UnknownError when the server error is not recognized', async () => {
      sandbox.stub(axios, 'get').rejects(new Error('boom'));

      await expect(service.listSources(CALENDAR_ID)).rejects.toThrow(UnknownError);
    });
  });

  describe('createSource', () => {
    it('POSTs the url and deserializes the response', async () => {
      const payload = sourcePayload({ url: 'https://example.com/new.ics' });
      const postStub = sandbox.stub(axios, 'post').resolves({ data: payload });

      const result = await service.createSource(CALENDAR_ID, 'https://example.com/new.ics');

      expect(postStub.calledOnce).toBe(true);
      expect(postStub.firstCall.args[0]).toBe(
        `/api/v1/calendars/${CALENDAR_ID}/import-sources`,
      );
      expect(postStub.firstCall.args[1]).toEqual({ url: 'https://example.com/new.ics' });
      expect(result).toBeInstanceOf(ImportSource);
      expect(result.url).toBe('https://example.com/new.ics');
    });

    it('throws CalendarEditorPermissionError when server returns that errorName', async () => {
      sandbox.stub(axios, 'post').rejects({
        response: { data: { errorName: 'CalendarEditorPermissionError' } },
      });

      await expect(
        service.createSource(CALENDAR_ID, 'https://example.com/x.ics'),
      ).rejects.toThrow(CalendarEditorPermissionError);
    });
  });

  describe('getSource', () => {
    it('calls the single-source endpoint and deserializes the response', async () => {
      const payload = sourcePayload();
      const getStub = sandbox.stub(axios, 'get').resolves({ data: payload });

      const result = await service.getSource(CALENDAR_ID, SOURCE_ID);

      expect(getStub.calledOnce).toBe(true);
      expect(getStub.firstCall.args[0]).toBe(
        `/api/v1/calendars/${CALENDAR_ID}/import-sources/${SOURCE_ID}`,
      );
      expect(result).toBeInstanceOf(ImportSource);
      expect(result.id).toBe(SOURCE_ID);
    });

    it('throws ImportSourceNotFoundError when server returns that errorName', async () => {
      sandbox.stub(axios, 'get').rejects({
        response: { data: { errorName: 'ImportSourceNotFoundError' } },
      });

      await expect(service.getSource(CALENDAR_ID, SOURCE_ID)).rejects.toThrow(
        ImportSourceNotFoundError,
      );
    });
  });

  describe('deleteSource', () => {
    it('calls the delete endpoint', async () => {
      const deleteStub = sandbox.stub(axios, 'delete').resolves({ data: null });

      await service.deleteSource(CALENDAR_ID, SOURCE_ID);

      expect(deleteStub.calledOnce).toBe(true);
      expect(deleteStub.firstCall.args[0]).toBe(
        `/api/v1/calendars/${CALENDAR_ID}/import-sources/${SOURCE_ID}`,
      );
    });

    it('throws UnauthenticatedError when server returns that errorName', async () => {
      sandbox.stub(axios, 'delete').rejects({
        response: { data: { errorName: 'UnauthenticatedError' } },
      });

      await expect(service.deleteSource(CALENDAR_ID, SOURCE_ID)).rejects.toThrow(
        UnauthenticatedError,
      );
    });
  });

  describe('issueChallenge', () => {
    it('POSTs to the verify-issue endpoint and returns the token', async () => {
      const postStub = sandbox.stub(axios, 'post').resolves({
        data: { challengeToken: 'test-token-xyz' },
      });

      const result = await service.issueChallenge(CALENDAR_ID, SOURCE_ID);

      expect(postStub.calledOnce).toBe(true);
      expect(postStub.firstCall.args[0]).toBe(
        `/api/v1/calendars/${CALENDAR_ID}/import-sources/${SOURCE_ID}/verify-issue`,
      );
      // Backwards-compatible call (no verificationType): empty body, no
      // discriminator key sent so the server falls back to the source's
      // existing verification_type.
      expect(postStub.firstCall.args[1]).toEqual({});
      expect(result).toBe('test-token-xyz');
    });

    it('sends verification_type in body when verificationType is provided', async () => {
      const postStub = sandbox.stub(axios, 'post').resolves({
        data: { challengeToken: 'rel-me-token' },
      });

      const result = await service.issueChallenge(CALENDAR_ID, SOURCE_ID, 'rel-me');

      expect(postStub.calledOnce).toBe(true);
      expect(postStub.firstCall.args[1]).toEqual({ verification_type: 'rel-me' });
      expect(result).toBe('rel-me-token');
    });

    it('sends verification_type=dns-txt when explicitly requested', async () => {
      const postStub = sandbox.stub(axios, 'post').resolves({
        data: { challengeToken: 'dns-token' },
      });

      await service.issueChallenge(CALENDAR_ID, SOURCE_ID, 'dns-txt');

      expect(postStub.firstCall.args[1]).toEqual({ verification_type: 'dns-txt' });
    });

    it('returns empty string when the server response omits the token', async () => {
      sandbox.stub(axios, 'post').resolves({ data: {} });

      const result = await service.issueChallenge(CALENDAR_ID, SOURCE_ID);
      expect(result).toBe('');
    });

    it('throws ImportSourceNotFoundError when the source is missing', async () => {
      sandbox.stub(axios, 'post').rejects({
        response: { data: { errorName: 'ImportSourceNotFoundError' } },
      });

      await expect(service.issueChallenge(CALENDAR_ID, SOURCE_ID)).rejects.toThrow(
        ImportSourceNotFoundError,
      );
    });
  });

  describe('verifySource', () => {
    it('POSTs to the verify endpoint and deserializes the updated source', async () => {
      const payload = sourcePayload({
        verificationState: 'verified',
        verifiedAt: '2026-04-22T00:00:00.000Z',
      });
      const postStub = sandbox.stub(axios, 'post').resolves({ data: payload });

      const result = await service.verifySource(CALENDAR_ID, SOURCE_ID);

      expect(postStub.calledOnce).toBe(true);
      expect(postStub.firstCall.args[0]).toBe(
        `/api/v1/calendars/${CALENDAR_ID}/import-sources/${SOURCE_ID}/verify`,
      );
      // Backwards-compatible call (no verificationPageUrl): empty body so
      // the dns-txt flow keeps working without sending a rel-me-only key.
      expect(postStub.firstCall.args[1]).toEqual({});
      expect(result).toBeInstanceOf(ImportSource);
      expect(result.verificationState).toBe('verified');
      expect(result.verifiedAt).toBeInstanceOf(Date);
    });

    it('sends verification_page_url in body when verificationPageUrl is provided', async () => {
      const payload = sourcePayload({
        verificationState: 'verified',
        verifiedAt: '2026-04-22T00:00:00.000Z',
      });
      const postStub = sandbox.stub(axios, 'post').resolves({ data: payload });

      await service.verifySource(
        CALENDAR_ID,
        SOURCE_ID,
        'https://example.com/about',
      );

      expect(postStub.calledOnce).toBe(true);
      expect(postStub.firstCall.args[1]).toEqual({
        verification_page_url: 'https://example.com/about',
      });
    });

    it('throws ImportSourceDnsVerificationError when server returns that errorName', async () => {
      sandbox.stub(axios, 'post').rejects({
        response: {
          data: {
            errorName: 'ImportSourceDnsVerificationError',
            reason: IMPORT_DNS_NOT_FOUND,
          },
        },
      });

      await expect(service.verifySource(CALENDAR_ID, SOURCE_ID)).rejects.toThrow(
        ImportSourceDnsVerificationError,
      );
    });

    it('throws ImportSourceVerifyRateLimitError when rate-limited', async () => {
      sandbox.stub(axios, 'post').rejects({
        response: { data: { errorName: 'ImportSourceVerifyRateLimitError' } },
      });

      await expect(service.verifySource(CALENDAR_ID, SOURCE_ID)).rejects.toThrow(
        ImportSourceVerifyRateLimitError,
      );
    });
  });

  describe('syncSource', () => {
    it('POSTs to the sync endpoint and returns the run summary', async () => {
      const summary = {
        id: '44444444-4444-4444-4444-444444444444',
        importSourceId: SOURCE_ID,
        startedAt: '2026-04-22T00:00:00.000Z',
        finishedAt: '2026-04-22T00:00:05.000Z',
        outcome: 'success',
        eventsCreated: 2,
        eventsUpdated: 1,
        eventsSkippedLocallyEdited: 0,
        eventsDisappeared: 0,
        errorMessage: null,
      };
      const postStub = sandbox.stub(axios, 'post').resolves({ data: summary });

      const result = await service.syncSource(CALENDAR_ID, SOURCE_ID);

      expect(postStub.calledOnce).toBe(true);
      expect(postStub.firstCall.args[0]).toBe(
        `/api/v1/calendars/${CALENDAR_ID}/import-sources/${SOURCE_ID}/sync`,
      );
      expect(result.outcome).toBe('success');
      expect(result.eventsCreated).toBe(2);
    });

    it('throws ImportSourceFetchError when server returns that errorName', async () => {
      sandbox.stub(axios, 'post').rejects({
        response: { data: { errorName: 'ImportSourceFetchError' } },
      });

      await expect(service.syncSource(CALENDAR_ID, SOURCE_ID)).rejects.toThrow(
        ImportSourceFetchError,
      );
    });

    it('throws ImportSourceSsrfBlockedError when server returns that errorName', async () => {
      sandbox.stub(axios, 'post').rejects({
        response: { data: { errorName: 'ImportSourceSsrfBlockedError' } },
      });

      await expect(service.syncSource(CALENDAR_ID, SOURCE_ID)).rejects.toThrow(
        ImportSourceSsrfBlockedError,
      );
    });
  });

  describe('id validation', () => {
    it('rejects empty calendarId before issuing a request', async () => {
      const getStub = sandbox.stub(axios, 'get');

      await expect(service.listSources('   ')).rejects.toThrow('Calendar ID cannot be empty');
      expect(getStub.called).toBe(false);
    });

    it('rejects empty source id before issuing a request', async () => {
      const getStub = sandbox.stub(axios, 'get');

      await expect(service.getSource(CALENDAR_ID, '')).rejects.toThrow(
        'Import Source ID cannot be empty',
      );
      expect(getStub.called).toBe(false);
    });
  });
});
