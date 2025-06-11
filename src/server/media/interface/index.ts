import { EventEmitter } from 'events';
import MediaService from '@/server/media/service/media';
import { Media } from '@/common/model/media';

export default class MediaInterface {
  private mediaService: MediaService;

  constructor(eventBus: EventEmitter ) {
    this.mediaService = new MediaService(eventBus);
  }

  async uploadFile(
    calendarId: string,
    buffer: Buffer,
    originalFilename: string,
    mimeType: string,
    eventId?: string,
  ): Promise<Media> {
    return this.mediaService.uploadFile(calendarId, buffer, originalFilename, mimeType, eventId);
  }

  async checkFileSafety(mediaId: string): Promise<boolean> {
    return this.mediaService.checkFileSafety(mediaId);
  }
}
