import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';
import ModerationInterface from '../interface';

/**
 * Event handlers for the moderation domain.
 *
 * Listens for cross-domain events and triggers moderation-related
 * side effects. Currently minimal; actual handlers will be added
 * in later epics when cross-domain reactions are needed (e.g.
 * sending notification emails on report status changes).
 */
export default class ModerationEventHandlers implements DomainEventHandlers {
  private service: ModerationInterface;

  constructor(service: ModerationInterface) {
    this.service = service;
  }

  install(_eventBus: EventEmitter): void {
    // Event handlers will be added in later epics when cross-domain
    // reactions are needed (e.g. sending notification emails).
  }
}
