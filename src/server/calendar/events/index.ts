import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';

export default class CalendarEventHandlers implements DomainEventHandlers {
  constructor() {}

  install(eventBus: EventEmitter): void {
    // No events handlers yet
  }
}
