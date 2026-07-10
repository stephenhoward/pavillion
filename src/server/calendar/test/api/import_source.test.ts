// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';

import { Account } from '@/common/model/account';
import { ImportSource } from '@/common/model/import_source';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import {
  ImportSourceNotFoundError,
  ImportSourceNotVerifiedError,
  ImportSourceDnsVerificationError,
  ImportSourceRelMeVerificationError,
  ImportSourceVerifyRateLimitError,
  ImportSourceFetchError,
  ImportSourceSsrfBlockedError,
  ImportSourceParseError,
  ImportSourceFileEmptyError,
  ImportSourceFileTooManyEventsError,
  ImportSourceFileBadFormatError,
  ImportSourceCapExceededError,
  IMPORT_DNS_NOT_FOUND,
  IMPORT_RELME_LINK_NOT_FOUND,
} from '@/common/exceptions/import';
import type { SyncResult } from '@/server/calendar/service/import/sync';
import { testApp } from '@/server/common/test/lib/express';
import ImportSourceRoutes from '@/server/calendar/api/v1/import_source';
import CalendarInterface from '@/server/calendar/interface';

/**
 * API-layer tests for ImportSourceRoutes (pv-1qcp.1.5).
 *
 * Covers the CRUD surface end-to-end through supertest, plus the
 * verify/sync placeholders (501) that will be fleshed out in later
 * beads.
 */
describe('ImportSourceRoutes', () => {
  const CALENDAR_ID = '550e8400-e29b-41d4-a716-446655440000';
  const SOURCE_ID = '660e8400-e29b-41d4-a716-446655440111';
  const INVALID_ID = 'not-a-uuid';

  let routes: ImportSourceRoutes;
  let router: express.Router;
  let mockInterface: CalendarInterface;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    mockInterface = {
      listImportSources: sandbox.stub(),
      createImportSource: sandbox.stub(),
      createImportSourceFromFile: sandbox.stub(),
      getImportSource: sandbox.stub(),
      deleteImportSource: sandbox.stub(),
      issueImportSourceChallenge: sandbox.stub(),
      verifyImportSource: sandbox.stub(),
      syncImportSource: sandbox.stub(),
    } as any;

    routes = new ImportSourceRoutes(mockInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  function makeSource(id: string = SOURCE_ID, calendarId: string = CALENDAR_ID): ImportSource {
    const source = new ImportSource(id, calendarId, 'https://example.com/events.ics');
    source.verificationState = 'pending';
    return source;
  }

  function attachAccount(req: express.Request): void {
    req.user = new Account('account-id', 'testuser', 'test@example.com');
  }

  describe('GET /calendars/:calendarId/import-sources', () => {
    it('returns the list of sources for a valid calendar', async () => {
      const stub = mockInterface.listImportSources as sinon.SinonStub;
      stub.resolves([makeSource()]);

      router.get('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        routes.listSources(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(SOURCE_ID);
      expect(response.body[0].calendarId).toBe(CALENDAR_ID);
      // Verification token must never leak through list responses.
      expect(response.body[0]).not.toHaveProperty('verificationToken');
    });

    it('returns 404 with errorName when the calendar is missing', async () => {
      const stub = mockInterface.listImportSources as sinon.SinonStub;
      stub.rejects(new CalendarNotFoundError());

      router.get('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        routes.listSources(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('returns 403 when the caller lacks edit access', async () => {
      const stub = mockInterface.listImportSources as sinon.SinonStub;
      stub.rejects(new CalendarEditorPermissionError());

      router.get('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        routes.listSources(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('CalendarEditorPermissionError');
    });

    it('returns 400 when calendarId is not a UUID', async () => {
      router.get('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = INVALID_ID;
        routes.listSources(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });
  });

  describe('POST /calendars/:calendarId/import-sources', () => {
    it('creates a new source and returns 201', async () => {
      const stub = mockInterface.createImportSource as sinon.SinonStub;
      stub.resolves(makeSource());

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        routes.createSource(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ url: 'https://example.com/events.ics' });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe(SOURCE_ID);
      expect(response.body.url).toBe('https://example.com/events.ics');
      expect(stub.calledOnce).toBe(true);
      expect(stub.firstCall.args[1]).toBe(CALENDAR_ID);
      expect(stub.firstCall.args[2]).toBe('https://example.com/events.ics');
      // Verification token must never leak through create responses.
      // Three-layer defense: entity.toModel + model.toObject + this test.
      expect(response.body).not.toHaveProperty('verificationToken');
      expect(
        Object.keys(response.body).some(k => k.toLowerCase().includes('token')),
      ).toBe(false);
    });

    it('forwards a ValidationError with field-level details', async () => {
      const stub = mockInterface.createImportSource as sinon.SinonStub;
      stub.rejects(
        new ValidationError('Invalid import source URL', {
          url: ['Invalid URL format'],
        }),
      );

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        routes.createSource(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ url: 'not-a-url' });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      expect(response.body.fields?.url).toEqual(['Invalid URL format']);
    });

    it('returns 500 with a generic message on unexpected errors', async () => {
      const stub = mockInterface.createImportSource as sinon.SinonStub;
      stub.rejects(new Error('Some internal database failure'));

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        routes.createSource(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ url: 'https://example.com/events.ics' });

      expect(response.status).toBe(500);
      // No internal details must leak into the response body.
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('database failure');
    });
  });

  describe('POST /calendars/:calendarId/import-sources/file', () => {
    const VALID_ICS = 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:a@x\nEND:VEVENT\nEND:VCALENDAR\n';

    function makeFileSource(): ImportSource {
      const source = new ImportSource(SOURCE_ID, CALENDAR_ID, null);
      source.sourceType = 'file';
      source.originalFilename = 'calendar.ics';
      source.verificationState = 'verified';
      return source;
    }

    function makeRun(): SyncResult {
      return {
        runId: 'run-file',
        startedAt: new Date('2026-07-08T10:00:00Z'),
        outcome: 'success',
        eventsCreated: 3,
        eventsUpdated: 1,
        eventsSkippedLocallyEdited: 0,
        eventsDisappeared: 0,
        eventsSkippedSyncManaged: 0,
        eventsPreservedLocalEdits: 0,
        skippedSyncManagedDetails: [],
        errorMessage: null,
      };
    }

    /**
     * Register the real route pipeline (pre-middleware that stamps the account
     * + calendarId, then the multer intake middleware, then the handler) so the
     * multipart parsing and content-type gating are exercised end-to-end.
     */
    function registerFileRoute(calendarId: string = CALENDAR_ID): void {
      router.post(
        '/handler',
        (req, _res, next) => {
          attachAccount(req);
          req.params.calendarId = calendarId;
          next();
        },
        routes.uploadIcsFile.bind(routes),
        (req, res) => routes.createSourceFromFile(req, res),
      );
    }

    it('creates a file source and returns 201 with { source, run }', async () => {
      const stub = mockInterface.createImportSourceFromFile as sinon.SinonStub;
      stub.resolves({ source: makeFileSource(), run: makeRun() });

      registerFileRoute();

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from(VALID_ICS), {
          filename: 'calendar.ics',
          contentType: 'text/calendar',
        });

      expect(response.status).toBe(201);
      expect(response.body.source.sourceType).toBe('file');
      expect(response.body.source.url).toBeNull();
      expect(response.body.source.originalFilename).toBe('calendar.ics');
      expect(response.body.run.eventsCreated).toBe(3);
      expect(response.body.run.eventsUpdated).toBe(1);
      expect(response.body.run.importSourceId).toBe(SOURCE_ID);
      expect(stub.calledOnce).toBe(true);
      // Buffer + filename forwarded to the service.
      expect(Buffer.isBuffer(stub.firstCall.args[2])).toBe(true);
      expect(stub.firstCall.args[3]).toBe('calendar.ics');
    });

    it('accepts an octet-stream MIME when the filename ends in .ics', async () => {
      const stub = mockInterface.createImportSourceFromFile as sinon.SinonStub;
      stub.resolves({ source: makeFileSource(), run: makeRun() });

      registerFileRoute();

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from(VALID_ICS), {
          filename: 'export.ics',
          contentType: 'application/octet-stream',
        });

      expect(response.status).toBe(201);
      expect(stub.calledOnce).toBe(true);
    });

    it('returns 400 (ImportSourceFileEmptyError) when no file is attached', async () => {
      const stub = mockInterface.createImportSourceFromFile as sinon.SinonStub;
      registerFileRoute();

      const response = await request(testApp(router))
        .post('/handler')
        .field('note', 'no file here');

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ImportSourceFileEmptyError');
      expect(stub.called).toBe(false);
    });

    it('returns 400 (ImportSourceFileBadFormatError) for a disallowed type and non-.ics name', async () => {
      const stub = mockInterface.createImportSourceFromFile as sinon.SinonStub;
      registerFileRoute();

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from('<html></html>'), {
          filename: 'notacalendar.txt',
          contentType: 'text/plain',
        });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ImportSourceFileBadFormatError');
      expect(stub.called).toBe(false);
    });

    it('returns 400 (ImportSourceFileTooLargeError) when multer rejects an oversized upload', async () => {
      const stub = mockInterface.createImportSourceFromFile as sinon.SinonStub;
      registerFileRoute();

      const oversized = Buffer.concat([
        Buffer.from('BEGIN:VCALENDAR\n'),
        Buffer.alloc(10 * 1024 * 1024 + 1024),
      ]);

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', oversized, {
          filename: 'big.ics',
          contentType: 'text/calendar',
        });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ImportSourceFileTooLargeError');
      expect(stub.called).toBe(false);
    });

    it('returns 400 (ValidationError) when calendarId is not a UUID', async () => {
      registerFileRoute(INVALID_ID);

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from(VALID_ICS), {
          filename: 'calendar.ics',
          contentType: 'text/calendar',
        });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('maps the per-calendar cap to 409 (ImportSourceCapExceededError)', async () => {
      const stub = mockInterface.createImportSourceFromFile as sinon.SinonStub;
      stub.rejects(new ImportSourceCapExceededError());
      registerFileRoute();

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from(VALID_ICS), {
          filename: 'calendar.ics',
          contentType: 'text/calendar',
        });

      expect(response.status).toBe(409);
      expect(response.body.errorName).toBe('ImportSourceCapExceededError');
    });

    it('maps a parsed-but-empty file to 422 (ImportSourceParseError)', async () => {
      const stub = mockInterface.createImportSourceFromFile as sinon.SinonStub;
      stub.rejects(new ImportSourceParseError());
      registerFileRoute();

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from(VALID_ICS), {
          filename: 'calendar.ics',
          contentType: 'text/calendar',
        });

      expect(response.status).toBe(422);
      expect(response.body.errorName).toBe('ImportSourceParseError');
    });

    it('maps a malformed payload to 400 (ImportSourceFileBadFormatError)', async () => {
      const stub = mockInterface.createImportSourceFromFile as sinon.SinonStub;
      stub.rejects(new ImportSourceFileBadFormatError());
      registerFileRoute();

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from(VALID_ICS), {
          filename: 'calendar.ics',
          contentType: 'text/calendar',
        });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ImportSourceFileBadFormatError');
    });

    it('maps missing editor access to 403', async () => {
      const stub = mockInterface.createImportSourceFromFile as sinon.SinonStub;
      stub.rejects(new CalendarEditorPermissionError());
      registerFileRoute();

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from(VALID_ICS), {
          filename: 'calendar.ics',
          contentType: 'text/calendar',
        });

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('CalendarEditorPermissionError');
    });

    it('maps a missing calendar to 404', async () => {
      const stub = mockInterface.createImportSourceFromFile as sinon.SinonStub;
      stub.rejects(new CalendarNotFoundError());
      registerFileRoute();

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from(VALID_ICS), {
          filename: 'calendar.ics',
          contentType: 'text/calendar',
        });

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('surfaces a service-layer empty-buffer rejection as 400', async () => {
      const stub = mockInterface.createImportSourceFromFile as sinon.SinonStub;
      stub.rejects(new ImportSourceFileEmptyError());
      registerFileRoute();

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from(VALID_ICS), {
          filename: 'calendar.ics',
          contentType: 'text/calendar',
        });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ImportSourceFileEmptyError');
    });

    it('maps a too-many-events rejection to 422 (ImportSourceFileTooManyEventsError)', async () => {
      const stub = mockInterface.createImportSourceFromFile as sinon.SinonStub;
      stub.rejects(new ImportSourceFileTooManyEventsError({ parsedEvents: 20000, maxEvents: 10000 }));
      registerFileRoute();

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from(VALID_ICS), {
          filename: 'calendar.ics',
          contentType: 'text/calendar',
        });

      expect(response.status).toBe(422);
      expect(response.body.errorName).toBe('ImportSourceFileTooManyEventsError');
      // details must never travel over the wire.
      expect(JSON.stringify(response.body)).not.toContain('parsedEvents');
    });
  });

  describe('POST /calendars/:calendarId/import-sources/file — pre-buffer authorization', () => {
    const VALID_ICS = 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:a@x\nEND:VEVENT\nEND:VCALENDAR\n';

    /**
     * Register the REAL route pipeline including the pre-buffer authorization
     * middleware (assertFileUploadAccess) that runs BEFORE multer. This lets us
     * assert that an unauthorized caller is rejected without the upload ever
     * reaching the service.
     */
    function registerAuthorizedFileRoute(calendarId: string = CALENDAR_ID): void {
      router.post(
        '/handler',
        (req, _res, next) => {
          attachAccount(req);
          req.params.calendarId = calendarId;
          next();
        },
        (req, res, next) => routes.assertFileUploadAccess(req, res, next),
        routes.uploadIcsFile.bind(routes),
        (req, res) => routes.createSourceFromFile(req, res),
      );
    }

    it('rejects a non-editor with 403 and never processes the upload', async () => {
      (mockInterface as any).getCalendar = sandbox.stub().resolves({ id: CALENDAR_ID });
      (mockInterface as any).userCanModifyCalendar = sandbox.stub().resolves(false);
      const createStub = mockInterface.createImportSourceFromFile as sinon.SinonStub;

      registerAuthorizedFileRoute();

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from(VALID_ICS), {
          filename: 'calendar.ics',
          contentType: 'text/calendar',
        });

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('CalendarEditorPermissionError');
      // The upload was rejected before multer buffered / the service ran.
      expect(createStub.called).toBe(false);
    });

    it('returns 404 when the calendar does not exist, without processing the upload', async () => {
      (mockInterface as any).getCalendar = sandbox.stub().resolves(null);
      (mockInterface as any).userCanModifyCalendar = sandbox.stub().resolves(true);
      const createStub = mockInterface.createImportSourceFromFile as sinon.SinonStub;

      registerAuthorizedFileRoute();

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from(VALID_ICS), {
          filename: 'calendar.ics',
          contentType: 'text/calendar',
        });

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('CalendarNotFoundError');
      expect(createStub.called).toBe(false);
    });

    it('returns 400 for a non-UUID calendarId, without processing the upload', async () => {
      (mockInterface as any).getCalendar = sandbox.stub().resolves({ id: CALENDAR_ID });
      (mockInterface as any).userCanModifyCalendar = sandbox.stub().resolves(true);
      const getStub = (mockInterface as any).getCalendar as sinon.SinonStub;
      const createStub = mockInterface.createImportSourceFromFile as sinon.SinonStub;

      registerAuthorizedFileRoute(INVALID_ID);

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from(VALID_ICS), {
          filename: 'calendar.ics',
          contentType: 'text/calendar',
        });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      // UUID shape is rejected before any interface lookup.
      expect(getStub.called).toBe(false);
      expect(createStub.called).toBe(false);
    });

    it('proceeds to the handler when the caller is an editor', async () => {
      (mockInterface as any).getCalendar = sandbox.stub().resolves({ id: CALENDAR_ID });
      (mockInterface as any).userCanModifyCalendar = sandbox.stub().resolves(true);
      const createStub = mockInterface.createImportSourceFromFile as sinon.SinonStub;
      const source = new ImportSource(SOURCE_ID, CALENDAR_ID, null);
      source.sourceType = 'file';
      source.originalFilename = 'calendar.ics';
      createStub.resolves({
        source,
        run: {
          runId: 'run-file',
          startedAt: new Date('2026-07-08T10:00:00Z'),
          outcome: 'success',
          eventsCreated: 1,
          eventsUpdated: 0,
          eventsSkippedLocallyEdited: 0,
          eventsDisappeared: 0,
          eventsSkippedSyncManaged: 0,
          eventsPreservedLocalEdits: 0,
          skippedSyncManagedDetails: [],
          errorMessage: null,
        },
      });

      registerAuthorizedFileRoute();

      const response = await request(testApp(router))
        .post('/handler')
        .attach('file', Buffer.from(VALID_ICS), {
          filename: 'calendar.ics',
          contentType: 'text/calendar',
        });

      expect(response.status).toBe(201);
      expect(createStub.calledOnce).toBe(true);
    });
  });

  describe('GET /calendars/:calendarId/import-sources/:id', () => {
    it('returns a single source', async () => {
      const stub = mockInterface.getImportSource as sinon.SinonStub;
      stub.resolves(makeSource());

      router.get('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.getSource(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(SOURCE_ID);
      // Verification token must never leak through single-get responses.
      // Three-layer defense: entity.toModel + model.toObject + this test.
      expect(response.body).not.toHaveProperty('verificationToken');
      expect(
        Object.keys(response.body).some(k => k.toLowerCase().includes('token')),
      ).toBe(false);
    });

    it('returns 404 when the source is missing', async () => {
      const stub = mockInterface.getImportSource as sinon.SinonStub;
      stub.rejects(new ImportSourceNotFoundError());

      router.get('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.getSource(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('ImportSourceNotFoundError');
    });

    it('returns 400 when the source id is invalid', async () => {
      router.get('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = INVALID_ID;
        routes.getSource(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });
  });

  describe('DELETE /calendars/:calendarId/import-sources/:id', () => {
    it('returns 204 on successful delete', async () => {
      const stub = mockInterface.deleteImportSource as sinon.SinonStub;
      stub.resolves();

      router.delete('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.deleteSource(req, res);
      });

      const response = await request(testApp(router)).delete('/handler');

      expect(response.status).toBe(204);
      expect(stub.calledOnceWithExactly(
        sinon.match.instanceOf(Account),
        CALENDAR_ID,
        SOURCE_ID,
      )).toBe(true);
    });

    it('returns 404 when the source is missing', async () => {
      const stub = mockInterface.deleteImportSource as sinon.SinonStub;
      stub.rejects(new ImportSourceNotFoundError());

      router.delete('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.deleteSource(req, res);
      });

      const response = await request(testApp(router)).delete('/handler');

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('ImportSourceNotFoundError');
    });
  });

  describe('POST /calendars/:calendarId/import-sources/:id/verify-issue', () => {
    it('returns the challenge token on success', async () => {
      const stub = mockInterface.issueImportSourceChallenge as sinon.SinonStub;
      stub.resolves('test-token-abc');

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.issueChallenge(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(200);
      expect(response.body.challengeToken).toBe('test-token-abc');
    });

    it('returns 404 when the source is missing', async () => {
      const stub = mockInterface.issueImportSourceChallenge as sinon.SinonStub;
      stub.rejects(new ImportSourceNotFoundError());

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.issueChallenge(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('ImportSourceNotFoundError');
    });

    it('returns 400 when the source id is invalid', async () => {
      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = INVALID_ID;
        routes.issueChallenge(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('forwards verification_type body to the interface', async () => {
      const stub = mockInterface.issueImportSourceChallenge as sinon.SinonStub;
      stub.resolves('test-token-abc');

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.issueChallenge(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ verification_type: 'rel-me' });

      expect(response.status).toBe(200);
      expect(response.body.challengeToken).toBe('test-token-abc');
      expect(stub.calledOnce).toBe(true);
      // Interface signature is (account, calendarId, id, verificationType?)
      expect(stub.firstCall.args[1]).toBe(CALENDAR_ID);
      expect(stub.firstCall.args[2]).toBe(SOURCE_ID);
      expect(stub.firstCall.args[3]).toBe('rel-me');
    });

    it('omits verification_type when body is empty', async () => {
      const stub = mockInterface.issueImportSourceChallenge as sinon.SinonStub;
      stub.resolves('test-token-abc');

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.issueChallenge(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(200);
      expect(stub.firstCall.args[3]).toBeUndefined();
    });

    it('forwards an invalid verification_type value to the service for validation', async () => {
      // Handler stays thin — invalid type values are validated in the service
      // and surface as ValidationError.
      const stub = mockInterface.issueImportSourceChallenge as sinon.SinonStub;
      stub.rejects(
        new ValidationError('Invalid verification type', {
          verification_type: ['Invalid verification type'],
        }),
      );

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.issueChallenge(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ verification_type: 'bogus' });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      expect(response.body.fields?.verification_type).toEqual(['Invalid verification type']);
    });
  });

  describe('POST /calendars/:calendarId/import-sources/:id/verify', () => {
    it('returns the updated source on success', async () => {
      const verified = makeSource();
      verified.verificationState = 'verified';
      verified.verifiedAt = new Date();
      const stub = mockInterface.verifyImportSource as sinon.SinonStub;
      stub.resolves(verified);

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.verifySource(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(200);
      expect(response.body.verificationState).toBe('verified');
      expect(response.body.verifiedAt).not.toBeNull();
    });

    it('maps DNS verification failure to errorName + reason', async () => {
      const stub = mockInterface.verifyImportSource as sinon.SinonStub;
      stub.rejects(new ImportSourceDnsVerificationError(IMPORT_DNS_NOT_FOUND));

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.verifySource(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ImportSourceDnsVerificationError');
      expect(response.body.reason).toBe(IMPORT_DNS_NOT_FOUND);
    });

    it('maps verify rate limit to 429', async () => {
      const stub = mockInterface.verifyImportSource as sinon.SinonStub;
      stub.rejects(new ImportSourceVerifyRateLimitError());

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.verifySource(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(429);
      expect(response.body.errorName).toBe('ImportSourceVerifyRateLimitError');
    });

    it('maps ImportSourceNotFound to 404', async () => {
      const stub = mockInterface.verifyImportSource as sinon.SinonStub;
      stub.rejects(new ImportSourceNotFoundError());

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.verifySource(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('ImportSourceNotFoundError');
    });

    it('maps SSRF block to 400 with errorName', async () => {
      const stub = mockInterface.verifyImportSource as sinon.SinonStub;
      stub.rejects(new ImportSourceSsrfBlockedError());

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.verifySource(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ImportSourceSsrfBlockedError');
    });

    it('maps fetch error to 502 with errorName', async () => {
      const stub = mockInterface.verifyImportSource as sinon.SinonStub;
      stub.rejects(new ImportSourceFetchError());

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.verifySource(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(502);
      expect(response.body.errorName).toBe('ImportSourceFetchError');
    });

    it('forwards verification_page_url body to the interface', async () => {
      const verified = makeSource();
      verified.verificationState = 'verified';
      verified.verifiedAt = new Date();
      const stub = mockInterface.verifyImportSource as sinon.SinonStub;
      stub.resolves(verified);

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.verifySource(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ verification_page_url: 'https://example.com/profile' });

      expect(response.status).toBe(200);
      expect(stub.calledOnce).toBe(true);
      // Interface signature is (account, calendarId, id, verificationPageUrl?)
      expect(stub.firstCall.args[1]).toBe(CALENDAR_ID);
      expect(stub.firstCall.args[2]).toBe(SOURCE_ID);
      expect(stub.firstCall.args[3]).toBe('https://example.com/profile');
    });

    it('omits verification_page_url when body is empty', async () => {
      const verified = makeSource();
      verified.verificationState = 'verified';
      verified.verifiedAt = new Date();
      const stub = mockInterface.verifyImportSource as sinon.SinonStub;
      stub.resolves(verified);

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.verifySource(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(200);
      expect(stub.firstCall.args[3]).toBeUndefined();
    });

    it('maps rel-me verification failure to errorName + reason', async () => {
      const stub = mockInterface.verifyImportSource as sinon.SinonStub;
      stub.rejects(new ImportSourceRelMeVerificationError(IMPORT_RELME_LINK_NOT_FOUND));

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.verifySource(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ verification_page_url: 'https://example.com/profile' });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ImportSourceRelMeVerificationError');
      expect(response.body.reason).toBe(IMPORT_RELME_LINK_NOT_FOUND);
    });

    it('forwards a service ValidationError for missing verification_page_url', async () => {
      // Handler stays thin — when source.verificationType is 'rel-me' and
      // verification_page_url is missing or invalid, the service throws
      // ValidationError with field-level details.
      const stub = mockInterface.verifyImportSource as sinon.SinonStub;
      stub.rejects(
        new ValidationError('Verification page URL is required', {
          verification_page_url: ['Verification page URL is required'],
        }),
      );

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.verifySource(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      expect(response.body.fields?.verification_page_url).toEqual([
        'Verification page URL is required',
      ]);
    });
  });

  describe('POST /calendars/:calendarId/import-sources/:id/sync', () => {
    it('returns the ImportRunSummary on success', async () => {
      const stub = mockInterface.syncImportSource as sinon.SinonStub;
      const syncStartedAt = new Date('2026-04-22T10:00:00Z');
      stub.resolves({
        runId: 'run-id-123',
        startedAt: syncStartedAt,
        outcome: 'success',
        eventsCreated: 2,
        eventsUpdated: 1,
        eventsSkippedLocallyEdited: 0,
        eventsDisappeared: 0,
        errorMessage: null,
      });

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.syncSource(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('run-id-123');
      expect(response.body.importSourceId).toBe(SOURCE_ID);
      expect(response.body.outcome).toBe('success');
      expect(response.body.eventsCreated).toBe(2);
      expect(response.body.eventsUpdated).toBe(1);
      // The API must preserve the real run start time from the service —
      // NOT overwrite it with the current wall clock. See Item 1 of pv-1qcp.15.
      expect(response.body.startedAt).toBe(syncStartedAt.toISOString());
      expect(typeof response.body.finishedAt).toBe('string');
      // finishedAt is stamped at API-handler time, so it must be ≥ startedAt.
      expect(new Date(response.body.finishedAt).getTime())
        .toBeGreaterThanOrEqual(syncStartedAt.getTime());
    });

    it('maps SSRF block to 400 with errorName', async () => {
      const stub = mockInterface.syncImportSource as sinon.SinonStub;
      stub.rejects(new ImportSourceSsrfBlockedError());

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.syncSource(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ImportSourceSsrfBlockedError');
    });

    it('maps fetch error to 502 with errorName', async () => {
      const stub = mockInterface.syncImportSource as sinon.SinonStub;
      stub.rejects(new ImportSourceFetchError());

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.syncSource(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(502);
      expect(response.body.errorName).toBe('ImportSourceFetchError');
    });

    it('maps parse error to 422 with errorName', async () => {
      const stub = mockInterface.syncImportSource as sinon.SinonStub;
      stub.rejects(new ImportSourceParseError());

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.syncSource(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(422);
      expect(response.body.errorName).toBe('ImportSourceParseError');
    });

    it('maps sync rate limit to 429', async () => {
      const stub = mockInterface.syncImportSource as sinon.SinonStub;
      stub.rejects(new ImportSourceVerifyRateLimitError());

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.syncSource(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(429);
      expect(response.body.errorName).toBe('ImportSourceVerifyRateLimitError');
    });

    it('maps not-verified state error to 409', async () => {
      const stub = mockInterface.syncImportSource as sinon.SinonStub;
      stub.rejects(new ImportSourceNotVerifiedError());

      router.post('/handler', (req, res) => {
        attachAccount(req);
        req.params.calendarId = CALENDAR_ID;
        req.params.id = SOURCE_ID;
        routes.syncSource(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(409);
      expect(response.body.errorName).toBe('ImportSourceNotVerifiedError');
    });
  });
});
