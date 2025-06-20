import config from 'config';
import { EventEmitter } from "events";
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Disk } from 'flydrive';
import { MediaEntity } from '@/server/media/entity/media';
import { Media, MediaStatus } from '@/common/model/media';
import { StorageConfig, createStorageDisk } from './storage-factory';
import CalendarInterface from '@/server/calendar/interface';
import { Account } from '@/common/model/account';
import { CalendarNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';

interface MediaConfig {
  maxFileSize: number;
  allowedTypes: string[];
  allowedExtensions: string[];
  storage: StorageConfig;
}

export default class MediaService {
  private eventBus: EventEmitter;
  private config: MediaConfig;
  private calendarService: CalendarInterface;
  private storageDisk!: Disk;

  constructor(eventBus: EventEmitter, calendarService: CalendarInterface) {
    this.eventBus = eventBus;
    this.config = config.get<MediaConfig>('media');
    this.calendarService = calendarService;
    this.initializeStorage();
  }

  /**
   * Initialize storage disk asynchronously
   */
  private async initializeStorage(): Promise<void> {
    this.storageDisk = await createStorageDisk(this.config.storage, this.config.storage.basePath);
  }

  /**
   * Ensures storage is initialized
   */
  private async ensureStorageReady(): Promise<void> {
    if (!this.storageDisk) {
      await this.initializeStorage();
    }
  }

  /**
   * Generates storage key for staging area
   */
  private getStagingKey(calendarId: string, filename: string): string {
    return `staging/${calendarId}/${filename}`;
  }

  /**
   * Generates storage key for final storage
   */
  private getFinalKey(calendarId: string, filename: string): string {
    return `final/${calendarId}/${filename}`;
  }

  /**
   * Validates file type and size
   */
  private validateFile(buffer: Buffer, filename: string, mimeType: string): void {
    // Check file size
    if (buffer.length > this.config.maxFileSize) {
      throw new Error(`File size exceeds maximum allowed size of ${this.config.maxFileSize} bytes`);
    }

    // Check MIME type
    if (!this.config.allowedTypes.includes(mimeType)) {
      throw new Error(`MIME type ${mimeType} is not allowed`);
    }

    // Check file extension
    const extension = path.extname(filename).toLowerCase();
    if (!this.config.allowedExtensions.includes(extension)) {
      throw new Error(`File extension ${extension} is not allowed`);
    }
  }

  /**
   * Generates SHA-256 hash of file content
   */
  private generateFileHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Uploads a file to the staging storage area
   */
  async uploadFile(
    account: Account,
    calendarId: string,
    buffer: Buffer,
    originalFilename: string,
    mimeType: string,
    eventId?: string,
  ): Promise<Media> {

    const calendar = await this.calendarService.getCalendar(calendarId);
    const calendars = await this.calendarService.editableCalendarsForUser(account);

    if ( ! calendar ) {
      throw new CalendarNotFoundError('Calendar for event does not exist');
    }
    if ( ! calendars.some(c => c.id == calendar.id) ) {
      throw new InsufficientCalendarPermissionsError('Insufficient permissions to modify events in this calendar');
    }


    // Validate the file
    this.validateFile(buffer, originalFilename, mimeType);

    // Generate file hash
    const sha256 = this.generateFileHash(buffer);

    // Check if file already exists (duplicate detection)
    const existingMedia = await MediaEntity.findOne({ where: { sha256, calendar_id: calendarId } });
    if (existingMedia) {
      const media = existingMedia.toModel();
      return media;
    }

    // Ensure storage is ready
    await this.ensureStorageReady();

    // Create new media record
    const mediaId = uuidv4();
    const media = new Media(
      mediaId,
      calendarId,
      sha256,
      originalFilename,
      mimeType,
      buffer.length,
      'pending',
    );

    // Store file in staging area using SHA as filename
    const stagingKey = this.getStagingKey(calendarId, media.storageFilename);
    await this.storageDisk.put(stagingKey, buffer);

    // Save metadata to database
    const mediaEntity = MediaEntity.fromModel(media);
    console.log(mediaEntity);
    console.log(media);
    await mediaEntity.save();

    // Emit event for further processing
    this.eventBus.emit('fileUploaded', {
      media: media.toObject(),
      calendarId,
      eventId,
    });

    return media;
  }

  /**
   * Gets media by ID
   */
  async getMediaById(mediaId: string): Promise<Media | null> {
    const entity = await MediaEntity.findByPk(mediaId);
    return entity ? entity.toModel() : null;
  }

  /**
   * Updates media status
   */
  async updateMediaStatus(mediaId: string, status: MediaStatus): Promise<void> {
    await MediaEntity.update(
      {
        status,
        processed_at: new Date(),
      },
      { where: { id: mediaId } },
    );
  }

  /**
   * Moves a file from staging to final storage after safety check
   */
  async moveToFinalStorage(mediaId: string): Promise<void> {
    const media = await this.getMediaById(mediaId);
    if (!media) {
      throw new Error(`Media with ID ${mediaId} not found`);
    }

    // Ensure storage is ready
    await this.ensureStorageReady();

    const stagingKey = this.getStagingKey(media.calendarId, media.storageFilename);
    const finalKey = this.getFinalKey(media.calendarId, media.storageFilename);

    // Copy file from staging to final storage (use getBytes for binary data)
    const fileBytes = await this.storageDisk.getBytes(stagingKey);
    await this.storageDisk.put(finalKey, fileBytes);

    // Delete from staging storage
    await this.storageDisk.delete(stagingKey);

    // Update status
    await this.updateMediaStatus(mediaId, 'approved');
  }

  /**
   * Deletes a media file (marks as deleted and removes from storage)
   */
  async deleteMedia(mediaId: string): Promise<void> {
    const media = await this.getMediaById(mediaId);
    if (!media) {
      throw new Error(`Media with ID ${mediaId} not found`);
    }

    // Ensure storage is ready
    await this.ensureStorageReady();

    const stagingKey = this.getStagingKey(media.calendarId, media.storageFilename);
    const finalKey = this.getFinalKey(media.calendarId, media.storageFilename);

    // Try to delete from both storage locations
    try {
      await this.storageDisk.delete(stagingKey);
    }
    catch {
      // File might not be in staging storage
    }

    try {
      await this.storageDisk.delete(finalKey);
    }
    catch {
      // File might not be in final storage
    }

    // Update status to deleted
    await this.updateMediaStatus(mediaId, 'deleted');
  }

  /**
   * Placeholder for ClamAV safety checking
   */
  async checkFileSafety(mediaId: string): Promise<boolean> {
    // TODO: Implement ClamAV integration
    // For now, automatically approve all files
    // later we will delete the media if it fails the ClamAV check
    const media = await this.getMediaById(mediaId);
    if (!media) {
      throw new Error(`Media with ID ${mediaId} not found`);
    }

    if (media.status === 'pending') {
      await this.moveToFinalStorage(mediaId);
      return true;
    }

    return media.status === 'approved';
  }

  /**
   * Generates a signed URL for temporary access to a media file
   */
  async getSignedUrl(mediaId: string, expiresInSeconds: number = 3600): Promise<string> {
    const media = await this.getMediaById(mediaId);
    if (!media) {
      throw new Error(`Media with ID ${mediaId} not found`);
    }

    if (media.status !== 'approved') {
      throw new Error(`Media with ID ${mediaId} is not approved`);
    }

    // Ensure storage is ready
    await this.ensureStorageReady();

    const finalKey = this.getFinalKey(media.calendarId, media.storageFilename);
    return await this.storageDisk.getSignedUrl(finalKey, { expiresIn: `${expiresInSeconds}s` });
  }

  /**
   * Gets file content and metadata for a media ID
   */
  async getFileContent(mediaId: string): Promise<{ media: Media; buffer: Buffer } | null> {
    const media = await this.getMediaById(mediaId);
    if (!media) {
      return null;
    }

    if (media.status !== 'approved') {
      throw new Error(`Media with ID ${mediaId} is not approved`);
    }

    // Ensure storage is ready
    await this.ensureStorageReady();

    const finalKey = this.getFinalKey(media.calendarId, media.storageFilename);

    try {
      const contentBytes = await this.storageDisk.getBytes(finalKey);
      const buffer = Buffer.from(contentBytes);
      return { media, buffer };
    }
    catch (error) {
      console.error(`Error reading file for media ${mediaId}:`, error);
      return null;
    }
  }
}
