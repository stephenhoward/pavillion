import { PrimaryModel } from './model';

/**
 * Status of a media file in the system
 */
export type MediaStatus = 'pending' | 'approved' | 'failed' | 'deleted';

/**
 * Represents a media file uploaded to the system
 */
export class Media extends PrimaryModel {
  public calendarId: string;
  public sha256: string;
  public originalFilename: string;
  public mimeType: string;
  public fileSize: number;
  public status: MediaStatus;

  constructor(
    id: string,
    calendarId: string,
    sha256: string,
    originalFilename: string,
    mimeType: string,
    fileSize: number,
    status: MediaStatus = 'pending',
  ) {
    super(id);
    this.calendarId = calendarId;
    this.sha256 = sha256;
    this.originalFilename = originalFilename;
    this.mimeType = mimeType;
    this.fileSize = fileSize;
    this.status = status;
  }

  /**
   * Gets the file extension from the original filename
   */
  get fileExtension(): string {
    const lastDot = this.originalFilename.lastIndexOf('.');
    return lastDot !== -1 ? this.originalFilename.substring(lastDot) : '';
  }

  /**
   * Gets a safe filename for storage (using SHA + extension)
   */
  get storageFilename(): string {
    return `${this.sha256}${this.fileExtension}`;
  }

  /**
   * Checks if the media file is ready for public access
   */
  get isApproved(): boolean {
    return this.status === 'approved';
  }

  /**
   * Checks if the media file failed safety checks
   */
  get isFailed(): boolean {
    return this.status === 'failed';
  }

  /**
   * Converts the model to a plain object
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      calendarId: this.calendarId,
      sha256: this.sha256,
      originalFilename: this.originalFilename,
      mimeType: this.mimeType,
      fileSize: this.fileSize,
      status: this.status,
    };
  }

  /**
   * Creates a Media instance from a plain object
   */
  static fromObject(obj: Record<string, any>): Media {
    const media = new Media(
      obj.id,
      obj.calendarId,
      obj.sha256,
      obj.originalFilename,
      obj.mimeType,
      obj.fileSize,
      obj.status,
    );

    return media;
  }
}
