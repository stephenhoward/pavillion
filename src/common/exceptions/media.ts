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
