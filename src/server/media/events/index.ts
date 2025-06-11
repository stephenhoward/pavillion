import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';
import MediaInterface from '../interface';

export default class MediaEventHandlers implements DomainEventHandlers {
  private service: MediaInterface;

  constructor(service: MediaInterface) {
    this.service = service;
  }

  install(eventBus: EventEmitter): void {
    eventBus.on('fileUploaded', async (e) => {
      await this.service.checkFileSafety(e.media.mediaId);
    });
  }
}
