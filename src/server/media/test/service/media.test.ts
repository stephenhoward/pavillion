import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import MediaService from '@/server/media/service/media';
import { Media } from '@/common/model/media';
import { MediaFileTooLargeError, MediaInvalidTypeError, MediaStorageError } from '@/common/exceptions/media';
import { MediaEntity } from '@/server/media/entity/media';
import CalendarInterface from '@/server/calendar/interface';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';

describe('MediaService', () => {
  let mediaService: MediaService;
  let eventBus: EventEmitter;

  beforeEach(() => {
    eventBus = new EventEmitter();
    mediaService = new MediaService(eventBus);
  });

  afterEach(() => {
    eventBus.removeAllListeners();
  });

  describe('validateFile', () => {
    it('should validate a proper PNG file', () => {
      const buffer = Buffer.from('fake png data');
      const filename = 'test.png';
      const mimeType = 'image/png';

      // Should not throw
      expect(() => mediaService['validateFile'](buffer, filename, mimeType)).not.toThrow();
    });

    it('should validate a proper JPEG file', () => {
      const buffer = Buffer.from('fake jpeg data');
      const filename = 'test.jpg';
      const mimeType = 'image/jpeg';

      // Should not throw
      expect(() => mediaService['validateFile'](buffer, filename, mimeType)).not.toThrow();
    });

    it('should reject file with invalid MIME type', () => {
      const buffer = Buffer.from('fake data');
      const filename = 'test.txt';
      const mimeType = 'text/plain';

      expect(() => mediaService['validateFile'](buffer, filename, mimeType))
        .toThrow(MediaInvalidTypeError);
    });

    it('should reject file with invalid extension', () => {
      const buffer = Buffer.from('fake data');
      const filename = 'test.txt';
      const mimeType = 'image/png';

      expect(() => mediaService['validateFile'](buffer, filename, mimeType))
        .toThrow(MediaInvalidTypeError);
    });

    it('should reject file that is too large', () => {
      // Create a buffer larger than the configured max size (10MB default)
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
      const filename = 'large.png';
      const mimeType = 'image/png';

      expect(() => mediaService['validateFile'](largeBuffer, filename, mimeType))
        .toThrow(MediaFileTooLargeError);
    });
  });

  describe('generateFileHash', () => {
    it('should generate consistent SHA-256 hash', () => {
      const buffer = Buffer.from('test content');
      const hash1 = mediaService['generateFileHash'](buffer);
      const hash2 = mediaService['generateFileHash'](buffer);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 produces 64-character hex string
    });

    it('should generate different hashes for different content', () => {
      const buffer1 = Buffer.from('content 1');
      const buffer2 = Buffer.from('content 2');

      const hash1 = mediaService['generateFileHash'](buffer1);
      const hash2 = mediaService['generateFileHash'](buffer2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Media model', () => {
    it('should create media with proper properties', () => {
      const media = new Media(
        'test-id',
        'calendar-id',
        'abcd1234',
        'test.png',
        'image/png',
        1024,
        'pending',
      );

      expect(media.id).toBe('test-id');
      expect(media.calendarId).toBe('calendar-id');
      expect(media.sha256).toBe('abcd1234');
      expect(media.originalFilename).toBe('test.png');
      expect(media.mimeType).toBe('image/png');
      expect(media.fileSize).toBe(1024);
      expect(media.status).toBe('pending');
    });

    it('should generate correct storage filename', () => {
      const media = new Media(
        'test-id',
        'calendar-id',
        'abcd1234',
        'test.png',
        'image/png',
        1024,
      );

      expect(media.storageFilename).toBe('abcd1234.png');
    });

    it('should generate correct file extension', () => {
      const media = new Media(
        'test-id',
        'calendar-id',
        'abcd1234',
        'test.jpeg',
        'image/jpeg',
        1024,
      );

      expect(media.fileExtension).toBe('.jpeg');
    });

    it('should handle files without extension', () => {
      const media = new Media(
        'test-id',
        'calendar-id',
        'abcd1234',
        'testfile',
        'image/png',
        1024,
      );

      expect(media.fileExtension).toBe('');
      expect(media.storageFilename).toBe('abcd1234');
    });

    it('should check approval status correctly', () => {
      const pendingMedia = new Media('id', 'cal', 'hash', 'file.png', 'image/png', 1024, 'pending');
      const approvedMedia = new Media('id', 'cal', 'hash', 'file.png', 'image/png', 1024, 'approved');
      const failedMedia = new Media('id', 'cal', 'hash', 'file.png', 'image/png', 1024, 'failed');

      expect(pendingMedia.isApproved).toBe(false);
      expect(approvedMedia.isApproved).toBe(true);
      expect(failedMedia.isApproved).toBe(false);

      expect(pendingMedia.isFailed).toBe(false);
      expect(approvedMedia.isFailed).toBe(false);
      expect(failedMedia.isFailed).toBe(true);
    });

    it('should serialize/deserialize correctly', () => {
      const original = new Media(
        'test-id',
        'calendar-id',
        'abcd1234',
        'test.png',
        'image/png',
        1024,
        'approved',
      );

      const obj = original.toObject();
      const restored = Media.fromObject(obj);

      expect(restored.id).toBe(original.id);
      expect(restored.calendarId).toBe(original.calendarId);
      expect(restored.sha256).toBe(original.sha256);
      expect(restored.originalFilename).toBe(original.originalFilename);
      expect(restored.mimeType).toBe(original.mimeType);
      expect(restored.fileSize).toBe(original.fileSize);
      expect(restored.status).toBe(original.status);
    });
  });
});

describe('uploadFile storage error handling', () => {
  let sandbox: sinon.SinonSandbox;
  let mediaService: MediaService;
  let calendarService: CalendarInterface;
  let eventBus: EventEmitter;

  const testAccount = new Account('account-123', 'test@example.com');
  const calendarId = 'c3d4e5f6-0001-4000-8000-000000000001';
  const testCalendar = new Calendar(calendarId, 'testcalendar');

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();

    calendarService = {
      getCalendar: sandbox.stub().resolves(testCalendar),
      editableCalendarsForUser: sandbox.stub().resolves([testCalendar]),
    } as unknown as CalendarInterface;

    mediaService = new MediaService(eventBus, calendarService);
  });

  afterEach(() => {
    sandbox.restore();
    eventBus.removeAllListeners();
  });

  it('throws MediaStorageError when storageDisk.put rejects', async () => {
    // Stub MediaEntity.findOne to simulate no duplicate
    sandbox.stub(MediaEntity, 'findOne').resolves(null);

    // Stub MediaEntity.fromModel and save so the DB path doesn't run
    const fakeSave = sandbox.stub().resolves();
    sandbox.stub(MediaEntity, 'fromModel').returns({ save: fakeSave } as unknown as MediaEntity);

    // Force storageDisk to be initialised with a stub disk
    const fakeDisk = {
      put: sandbox.stub().rejects(new Error('Disk full')),
    };
    mediaService['storageDisk'] = fakeDisk as any;

    const buffer = Buffer.from('fake png data');

    await expect(
      mediaService.uploadFile(
        testAccount,
        calendarId,
        buffer,
        'photo.png',
        'image/png',
      ),
    ).rejects.toThrow(MediaStorageError);
  });
});
