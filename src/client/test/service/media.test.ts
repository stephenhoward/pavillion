import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import MediaService, { ValidationErrorCode, UploadErrorCode } from '../../service/media';

// Mock axios
vi.mock('axios');

// Mock the Media class
vi.mock('@/common/model/media', () => ({
  Media: {
    fromObject: vi.fn((obj) => obj),
  },
}));

describe('MediaService', () => {
  let mediaService: MediaService;

  beforeEach(() => {
    vi.clearAllMocks();
    mediaService = new MediaService();
  });

  describe('constructor', () => {
    it('should use default config when no config provided', () => {
      const service = new MediaService();
      expect(service).toBeInstanceOf(MediaService);
    });

    it('should merge provided config with defaults', () => {
      const service = new MediaService({
        maxFileSize: 5 * 1024 * 1024, // 5MB
        allowedTypes: ['image/png'],
      });
      expect(service).toBeInstanceOf(MediaService);
    });
  });

  describe('validateFile', () => {
    it('should validate file size', () => {
      const largeFile = new File(['x'.repeat(11 * 1024 * 1024)], 'large.jpg', {
        type: 'image/jpeg',
      });

      const result = mediaService.validateFile(largeFile);

      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe(ValidationErrorCode.FILE_TOO_LARGE);
      expect(result.error?.parameters?.fileSize).toBe(largeFile.size);
      expect(result.error?.parameters?.maxFileSize).toBe(10 * 1024 * 1024);
    });

    it('should validate MIME type', () => {
      const invalidFile = new File(['test'], 'test.pdf', {
        type: 'application/pdf',
      });

      const result = mediaService.validateFile(invalidFile);

      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe(ValidationErrorCode.INVALID_MIME_TYPE);
      expect(result.error?.parameters?.fileType).toBe('application/pdf');
    });

    it('should validate file extension', () => {
      const invalidFile = new File(['test'], 'test.pdf', {
        type: 'image/jpeg', // Valid MIME type but wrong extension
      });

      const result = mediaService.validateFile(invalidFile);

      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe(ValidationErrorCode.INVALID_EXTENSION);
      expect(result.error?.parameters?.extension).toBe('.pdf');
    });

    it('should pass validation for valid files', () => {
      const validFile = new File(['test'], 'test.jpg', {
        type: 'image/jpeg',
      });

      const result = mediaService.validateFile(validFile);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('generatePreview', () => {
    it('should generate preview for image files', async () => {
      const imageFile = new File(['fake-image-data'], 'test.jpg', {
        type: 'image/jpeg',
      });

      // Mock FileReader
      const mockFileReader = {
        readAsDataURL: vi.fn(),
        onload: null as any,
        onerror: null as any,
        result: 'data:image/jpeg;base64,fake-data',
      };

      Object.defineProperty(window, 'FileReader', {
        writable: true,
        value: vi.fn(() => mockFileReader),
      });

      const previewPromise = mediaService.generatePreview(imageFile);

      // Simulate successful file read
      if (mockFileReader.onload) {
        mockFileReader.onload({ target: { result: 'data:image/jpeg;base64,fake-data' } } as any);
      }

      const preview = await previewPromise;
      expect(preview).toBe('data:image/jpeg;base64,fake-data');
    });

    it('should reject for non-image files', async () => {
      const nonImageFile = new File(['test'], 'test.txt', {
        type: 'text/plain',
      });

      await expect(mediaService.generatePreview(nonImageFile))
        .rejects
        .toThrow(UploadErrorCode.NOT_AN_IMAGE);
    });
  });

  describe('uploadFile', () => {
    it('should return error for invalid files', async () => {
      const invalidFile = new File(['test'], 'test.pdf', {
        type: 'application/pdf',
      });

      const result = await mediaService.uploadFile(invalidFile, 'calendar-1');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(UploadErrorCode.VALIDATION_FAILED);
      expect(result.error?.parameters?.validationError?.code).toBe(ValidationErrorCode.INVALID_MIME_TYPE);
    });

    it('should upload valid files successfully', async () => {
      const validFile = new File(['test'], 'test.jpg', {
        type: 'image/jpeg',
      });

      // Mock axios.post to return successful response
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        data: { media: { id: '1', filename: 'test.jpg' } },
      };
      const axiosPost = vi.mocked(axios.post);
      axiosPost.mockResolvedValue(mockResponse);

      const result = await mediaService.uploadFile(validFile, 'calendar-1');

      expect(result.success).toBe(true);
      expect(result.filename).toBe('test.jpg');
      expect(axiosPost).toHaveBeenCalledWith(
        '/api/v1/media/calendar-1',
        expect.any(FormData),
        expect.objectContaining({
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          onUploadProgress: expect.any(Function),
        }),
      );
    });

    it('should handle upload progress', async () => {
      const validFile = new File(['test'], 'test.jpg', {
        type: 'image/jpeg',
      });

      const progressCallback = vi.fn();

      // Mock axios.post to simulate progress and return successful response
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        data: { media: { id: '1', filename: 'test.jpg' } },
      };

      const axiosPost = vi.mocked(axios.post);
      axiosPost.mockImplementation(async (url, data, config) => {
        // Simulate progress event
        if (config?.onUploadProgress) {
          config.onUploadProgress({
            loaded: 50,
            total: 100,
            bytes: 50,
            lengthComputable: true,
          });
        }
        return mockResponse;
      });

      await mediaService.uploadFile(validFile, 'calendar-1', undefined, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          loaded: 50,
          total: 100,
          percentage: 50,
          filename: 'test.jpg',
        }),
      );
    });
  });

  describe('uploadFiles', () => {
    it('should call uploadFile for each file', async () => {
      const file1 = new File(['test1'], 'test1.jpg', { type: 'image/jpeg' });
      const file2 = new File(['test2'], 'test2.jpg', { type: 'image/jpeg' });

      // Spy on uploadFile method
      const uploadFileSpy = vi.spyOn(mediaService, 'uploadFile').mockResolvedValue({
        success: true,
        fileId: 'mock-id',
        filename: 'mock.jpg',
        media: { id: '1', filename: 'test.jpg' } as any,
      });

      await mediaService.uploadFiles([file1, file2], 'calendar-1');

      expect(uploadFileSpy).toHaveBeenCalledTimes(2);
      expect(uploadFileSpy).toHaveBeenCalledWith(file1, 'calendar-1', undefined, undefined);
      expect(uploadFileSpy).toHaveBeenCalledWith(file2, 'calendar-1', undefined, undefined);

      uploadFileSpy.mockRestore();
    });
  });
});
