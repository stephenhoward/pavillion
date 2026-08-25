import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import MediaService from '@/server/media/service/media';

describe('MediaService Basic', () => {
  let mediaService: MediaService;
  let eventBus: EventEmitter;

  beforeEach(() => {
    eventBus = new EventEmitter();
    mediaService = new MediaService(eventBus);
  });

  it('should create MediaService instance', () => {
    expect(mediaService).toBeDefined();
    expect(mediaService).toBeInstanceOf(MediaService);
  });

  it('should validate file type correctly', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const filename = 'test.png';
    const mimeType = 'image/png';

    // Should not throw for valid file
    expect(() => mediaService['validateFile'](buffer, filename, mimeType)).not.toThrow();
  });

  it('should generate file hash', () => {
    const buffer = Buffer.from('test content');
    const hash = mediaService['generateFileHash'](buffer);

    expect(hash).toBeDefined();
    expect(hash).toHaveLength(64); // SHA-256 hash length
    expect(typeof hash).toBe('string');
  });
});
