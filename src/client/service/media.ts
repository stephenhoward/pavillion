import { Media } from '@/common/model/media';

/**
 * Upload progress information
 */
export interface UploadProgress {
  fileId: string;
  filename: string;
  loaded: number;
  total: number;
  percentage: number;
}

/**
 * File with upload state and preview
 */
export interface FileWithState {
  file: File;
  id: string;
  status: 'pending' | 'uploading' | 'complete' | 'failed';
  progress: number;
  preview?: string;
  error?: { code: ValidationErrorCode | UploadErrorCode; parameters?: Record<string, any> };
}

/**
 * Upload result for a single file
 */
export interface UploadResult {
  success: boolean;
  media?: Media;
  error?: {
    code: UploadErrorCode;
    parameters?: Record<string, any>;
  };
  fileId: string;
  filename: string;
}

/**
 * Validation error codes
 */
export enum ValidationErrorCode {
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_MIME_TYPE = 'INVALID_MIME_TYPE',
  INVALID_EXTENSION = 'INVALID_EXTENSION',
  TOO_MANY_FILES = 'TOO_MANY_FILES',
  SINGLE_FILE_ONLY = 'SINGLE_FILE_ONLY',
}

/**
 * Upload error codes
 */
export enum UploadErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  UPLOAD_ABORTED = 'UPLOAD_ABORTED',
  PREVIEW_GENERATION_FAILED = 'PREVIEW_GENERATION_FAILED',
  NOT_AN_IMAGE = 'NOT_AN_IMAGE',
}

/**
 * File validation error with parameters
 */
export interface ValidationError {
  code: ValidationErrorCode;
  parameters?: Record<string, any>;
}

/**
 * File validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: ValidationError;
}

/**
 * Configuration for file upload validation
 */
export interface UploadConfig {
  maxFileSize: number;
  allowedTypes: string[];
  allowedExtensions: string[];
}

/**
 * Service for handling media file uploads with modern browser APIs
 */
export default class MediaService {
  private static readonly DEFAULT_CONFIG: UploadConfig = {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/heic'],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.heic'],
  };

  public readonly config: UploadConfig;

  constructor(config?: Partial<UploadConfig>) {
    this.config = { ...MediaService.DEFAULT_CONFIG, ...config };
  }

  async prepareFile(file: File): Promise<FileWithState> {
    const fileWithState: FileWithState = {
      file,
      id: this.generateFileId(file),
      status: 'pending',
      progress: 0,
    };

    const validation = this.validateFile(file);

    if (!validation.valid && validation.error) {
      fileWithState.status = 'failed';
      fileWithState.error = validation.error;
    }
    else {
      // Generate preview for images
      try {
        fileWithState.preview = await this.generatePreview(file);
      }
      catch {
        // Preview generation failed, continue without preview
      }
    }

    return fileWithState;
  }

  /**
   * Validates a file before upload
   */
  validateFile(file: File): ValidationResult {
    // Check file size
    if (file.size > this.config.maxFileSize) {
      return {
        valid: false,
        error: {
          code: ValidationErrorCode.FILE_TOO_LARGE,
          parameters: {
            fileSize: file.size,
            maxFileSize: this.config.maxFileSize,
            fileSizeFormatted: this.formatFileSize(file.size),
            maxFileSizeFormatted: this.formatFileSize(this.config.maxFileSize),
          },
        },
      };
    }

    // Check MIME type
    if (!this.config.allowedTypes.includes(file.type)) {
      return {
        valid: false,
        error: {
          code: ValidationErrorCode.INVALID_MIME_TYPE,
          parameters: {
            fileType: file.type,
            allowedTypes: this.config.allowedTypes,
          },
        },
      };
    }

    // Check file extension
    const extension = this.getFileExtension(file.name).toLowerCase();
    if (extension && !this.config.allowedExtensions.includes(extension)) {
      return {
        valid: false,
        error: {
          code: ValidationErrorCode.INVALID_EXTENSION,
          parameters: {
            extension,
            allowedExtensions: this.config.allowedExtensions,
          },
        },
      };
    }

    return { valid: true };
  }

  /**
   * Generates a preview URL for an image file using FileReader
   */
  async generatePreview(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error(UploadErrorCode.NOT_AN_IMAGE));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        resolve(e.target?.result as string);
      };
      reader.onerror = () => {
        reject(new Error(UploadErrorCode.PREVIEW_GENERATION_FAILED));
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Uploads a single file to the server
   */
  async uploadFile(
    file: File,
    calendarId: string,
    eventId?: string,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<UploadResult> {
    const fileId = this.generateFileId(file);

    try {
      // Validate file first
      const validation = this.validateFile(file);
      if (!validation.valid) {
        return {
          success: false,
          error: {
            code: UploadErrorCode.VALIDATION_FAILED,
            parameters: {
              validationError: validation.error,
            },
          },
          fileId,
          filename: file.name,
        };
      }

      // Create FormData
      const formData = new FormData();
      formData.append('file', file);
      if (eventId) {
        formData.append('eventId', eventId);
      }

      // Create upload request with progress tracking
      const response = await this.uploadWithProgress(
        `/api/v1/media/${calendarId}`,
        formData,
        fileId,
        file.name,
        onProgress,
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`${UploadErrorCode.SERVER_ERROR}:${response.status}:${errorData.error || 'Unknown server error'}`);
      }

      const result = await response.json();
      return {
        success: true,
        media: Media.fromObject(result.media),
        fileId,
        filename: file.name,
      };
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';

      // Parse error codes from our custom error format
      if (errorMessage.startsWith(UploadErrorCode.SERVER_ERROR)) {
        const [, status, serverMessage] = errorMessage.split(':');
        return {
          success: false,
          error: {
            code: UploadErrorCode.SERVER_ERROR,
            parameters: {
              status: parseInt(status),
              serverMessage,
            },
          },
          fileId,
          filename: file.name,
        };
      }

      // Handle other error types
      let errorCode = UploadErrorCode.NETWORK_ERROR;
      if (errorMessage === UploadErrorCode.UPLOAD_ABORTED) {
        errorCode = UploadErrorCode.UPLOAD_ABORTED;
      }

      return {
        success: false,
        error: {
          code: errorCode,
          parameters: {
            message: errorMessage,
          },
        },
        fileId,
        filename: file.name,
      };
    }
  }

  /**
   * Uploads multiple files concurrently
   */
  async uploadFiles(
    files: File[],
    calendarId: string,
    eventId?: string,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<UploadResult[]> {
    const uploadPromises = files.map(file =>
      this.uploadFile(file, calendarId, eventId, onProgress),
    );

    return Promise.all(uploadPromises);
  }

  /**
   * Performs upload with progress tracking using fetch API
   */
  private async uploadWithProgress(
    url: string,
    formData: FormData,
    fileId: string,
    filename: string,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Track upload progress
      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const progress: UploadProgress = {
              fileId,
              filename,
              loaded: e.loaded,
              total: e.total,
              percentage: Math.round((e.loaded / e.total) * 100),
            };
            onProgress(progress);
          }
        });
      }

      xhr.addEventListener('load', () => {
        // Create a Response-like object for consistency
        const response = new Response(xhr.responseText, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: new Headers(),
        });
        resolve(response);
      });

      xhr.addEventListener('error', () => {
        reject(new Error(UploadErrorCode.NETWORK_ERROR));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error(UploadErrorCode.UPLOAD_ABORTED));
      });

      xhr.open('POST', url);

      // Add authentication header if available
      const token = localStorage.getItem('auth_token');
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      xhr.send(formData);
    });
  }

  /**
   * Generates a unique file ID for tracking
   */
  private generateFileId(file: File): string {
    return `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Gets file extension from filename
   */
  private getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot) : '';
  }

  /**
   * Formats file size in human-readable format
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
