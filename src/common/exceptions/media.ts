/**
 * Custom error class for media that is still pending approval
 */
export class MediaNotApprovedError extends Error {
  public readonly mediaId: string;
  public readonly status: string;

  constructor(mediaId: string, status: string = 'pending') {
    super(`Media with ID ${mediaId} is not approved (status: ${status})`);
    this.name = 'MediaNotApprovedError';
    this.mediaId = mediaId;
    this.status = status;
    Object.setPrototypeOf(this, MediaNotApprovedError.prototype);
  }
}

/**
 * Custom error class for media not found
 */
export class MediaNotFoundError extends Error {
  public readonly mediaId: string;

  constructor(mediaId: string) {
    super(`Media with ID ${mediaId} not found`);
    this.name = 'MediaNotFoundError';
    this.mediaId = mediaId;
    Object.setPrototypeOf(this, MediaNotFoundError.prototype);
  }
}

/**
 * Thrown when an uploaded file exceeds the maximum allowed size
 */
export class MediaFileTooLargeError extends Error {
  constructor() {
    super('File is too large');
    this.name = 'MediaFileTooLargeError';
    Object.setPrototypeOf(this, MediaFileTooLargeError.prototype);
  }
}

/**
 * Thrown when an uploaded file has a disallowed MIME type
 */
export class MediaInvalidTypeError extends Error {
  constructor() {
    super('File type is not supported');
    this.name = 'MediaInvalidTypeError';
    Object.setPrototypeOf(this, MediaInvalidTypeError.prototype);
  }
}

/**
 * Thrown when file storage fails (disk full, permissions, misconfiguration)
 */
export class MediaStorageError extends Error {
  constructor() {
    super('Unable to store file');
    this.name = 'MediaStorageError';
    Object.setPrototypeOf(this, MediaStorageError.prototype);
  }
}
