import { EventEmitter } from 'events';
import MediaService from '@/server/media/service/media';
import { Media } from '@/common/model/media';
import { Account } from '@/common/model/account';
import CalendarInterface from '@/server/calendar/interface';

export default class MediaInterface {
  private mediaService: MediaService;

  constructor(eventBus: EventEmitter, calendarInterface: CalendarInterface ) {
    this.mediaService = new MediaService(eventBus, calendarInterface);
  }

  async uploadFile(
    account: Account,
    calendarId: string,
    buffer: Buffer,
    originalFilename: string,
    mimeType: string,
    eventId?: string,
  ): Promise<Media> {
    return this.mediaService.uploadFile(account, calendarId, buffer, originalFilename, mimeType, eventId);
  }

  async getMediaById(mediaId: string): Promise<Media | null> {
    return this.mediaService.getMediaById(mediaId);
  }

  async checkFileSafety(mediaId: string): Promise<boolean> {
    return this.mediaService.checkFileSafety(mediaId);
  }

  async getFile(mediaId: string): Promise<{ media: Media; buffer: Buffer } | null> {
    return this.mediaService.getFileContent(mediaId);
  }
}
