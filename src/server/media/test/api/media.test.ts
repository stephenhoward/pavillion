import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';

import { Account } from '@/common/model/account';
import { Media } from '@/common/model/media';
import {
  CalendarNotFoundError,
  InsufficientCalendarPermissionsError,
} from '@/common/exceptions/calendar';
import {
  MediaFileTooLargeError,
  MediaInvalidTypeError,
  MediaStorageError,
} from '@/common/exceptions/media';

import ExpressHelper from '@/server/common/helper/express';
import MediaInterface from '@/server/media/interface';
import MediaRoutes from '@/server/media/api/v1/media';

const testAccount = new Account('account-123', 'test@example.com');

const testMedia = new Media(
  'a1b2c3d4-0001-4000-8000-000000000001',
  'c3d4e5f6-0001-4000-8000-000000000001',
  'abc123def456',
  'photo.png',
  'image/png',
  1024,
  'pending',
);

const VALID_CALENDAR_ID = 'c3d4e5f6-0001-4000-8000-000000000001';
const VALID_MEDIA_ID    = 'a1b2c3d4-0001-4000-8000-000000000001';

describe('Media API', () => {
  let app: Application;
  let sandbox: sinon.SinonSandbox;
  let mediaInterface: MediaInterface;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Bypass JWT auth — inject test account directly
    sandbox.stub(ExpressHelper, 'loggedInOnly').value([
      (req: Request, _res: Response, next: NextFunction) => {
        req.user = testAccount;
        next();
      },
    ]);

    // Build a minimal MediaInterface stub (avoid real service/storage init)
    mediaInterface = {
      uploadFile: sandbox.stub(),
      getMediaById: sandbox.stub(),
      checkFileSafety: sandbox.stub(),
      getFile: sandbox.stub(),
    } as unknown as MediaInterface;

    app = express();
    app.use(express.json());

    const routes = new MediaRoutes(mediaInterface);
    routes.installHandlers(app, '/api/v1/media');
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/media/:calendarId  — uploadFile
  // ---------------------------------------------------------------------------

  describe('POST /api/v1/media/:calendarId', () => {
    it('returns 400 ValidationError when no file is attached', async () => {
      // Send a valid multipart request but with no file field — multer will
      // set req.file = undefined which triggers the ValidationError branch.
      const response = await request(app)
        .post(`/api/v1/media/${VALID_CALENDAR_ID}`)
        .field('eventId', 'some-event-id'); // valid multipart, but no .attach()

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('returns 400 ValidationError when calendarId is not a UUID', async () => {
      const response = await request(app)
        .post('/api/v1/media/not-a-valid-uuid')
        .attach('file', Buffer.from('fake image data'), 'photo.png');

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('returns 201 with media object on successful upload', async () => {
      (mediaInterface.uploadFile as sinon.SinonStub).resolves(testMedia);

      const response = await request(app)
        .post(`/api/v1/media/${VALID_CALENDAR_ID}`)
        .attach('file', Buffer.from('fake image data'), 'photo.png');

      expect(response.status).toBe(201);
      expect(response.body.media).toBeDefined();
      expect(response.body.media.id).toBe(testMedia.id);
      expect(response.body.media.calendarId).toBe(testMedia.calendarId);
    });

    it('returns 400 MediaFileTooLargeError when service throws MediaFileTooLargeError', async () => {
      (mediaInterface.uploadFile as sinon.SinonStub).rejects(new MediaFileTooLargeError());

      const response = await request(app)
        .post(`/api/v1/media/${VALID_CALENDAR_ID}`)
        .attach('file', Buffer.from('huge file'), 'photo.png');

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('MediaFileTooLargeError');
    });

    it('returns 400 MediaInvalidTypeError when service throws MediaInvalidTypeError', async () => {
      (mediaInterface.uploadFile as sinon.SinonStub).rejects(new MediaInvalidTypeError());

      const response = await request(app)
        .post(`/api/v1/media/${VALID_CALENDAR_ID}`)
        .attach('file', Buffer.from('bad type'), 'photo.exe');

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('MediaInvalidTypeError');
    });

    it('returns 404 CalendarNotFoundError when service throws CalendarNotFoundError', async () => {
      (mediaInterface.uploadFile as sinon.SinonStub).rejects(
        new CalendarNotFoundError('Calendar not found'),
      );

      const response = await request(app)
        .post(`/api/v1/media/${VALID_CALENDAR_ID}`)
        .attach('file', Buffer.from('data'), 'photo.png');

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('returns 403 InsufficientCalendarPermissionsError when service throws that error', async () => {
      (mediaInterface.uploadFile as sinon.SinonStub).rejects(
        new InsufficientCalendarPermissionsError('No permission'),
      );

      const response = await request(app)
        .post(`/api/v1/media/${VALID_CALENDAR_ID}`)
        .attach('file', Buffer.from('data'), 'photo.png');

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('returns 500 MediaStorageError when service throws MediaStorageError', async () => {
      (mediaInterface.uploadFile as sinon.SinonStub).rejects(new MediaStorageError());

      const response = await request(app)
        .post(`/api/v1/media/${VALID_CALENDAR_ID}`)
        .attach('file', Buffer.from('data'), 'photo.png');

      expect(response.status).toBe(500);
      expect(response.body.errorName).toBe('MediaStorageError');
    });

    it('returns 500 UnknownError when service throws an unexpected error', async () => {
      (mediaInterface.uploadFile as sinon.SinonStub).rejects(new Error('Something broke'));

      const response = await request(app)
        .post(`/api/v1/media/${VALID_CALENDAR_ID}`)
        .attach('file', Buffer.from('data'), 'photo.png');

      expect(response.status).toBe(500);
      expect(response.body.errorName).toBe('UnknownError');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/media/:mediaId  — serveFile
  // ---------------------------------------------------------------------------

  describe('GET /api/v1/media/:mediaId', () => {
    it('returns 400 ValidationError when mediaId is not a UUID', async () => {
      const response = await request(app).get('/api/v1/media/not-a-uuid');

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('returns 404 MediaNotFoundError when service returns null', async () => {
      (mediaInterface.getFile as sinon.SinonStub).resolves(null);

      const response = await request(app).get(`/api/v1/media/${VALID_MEDIA_ID}`);

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('MediaNotFoundError');
    });

    it('returns file buffer with correct headers on success', async () => {
      const fileBuffer = Buffer.from('fake png bytes');
      (mediaInterface.getFile as sinon.SinonStub).resolves({
        media: testMedia,
        buffer: fileBuffer,
      });

      const response = await request(app).get(`/api/v1/media/${VALID_MEDIA_ID}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
    });
  });
});
