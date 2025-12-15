import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';
import MediaInterface from '../interface';

export default class MediaEventHandlers implements DomainEventHandlers {
  private service: MediaInterface;

  constructor(service: MediaInterface) {
    this.service = service;
  }

  install(eventBus: EventEmitter): void {
    // When media is attached to an event, approve it and move to final storage
    // Only process new uploads (status: 'pending'), not already-approved media
    eventBus.on('mediaAttachedToEvent', async (e: { mediaId: string; eventId: string }) => {
      try {
        const media = await this.service.getMediaById(e.mediaId);
        if (media && media.status === 'pending') {
          await this.service.checkFileSafety(e.mediaId);
        }
      }
      catch (error) {
        console.error('Error in mediaAttachedToEvent handler:', error);
      }
    });
  }
}
