import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';

export default class AccountsEventHandlers implements DomainEventHandlers {

  install(eventBus: EventEmitter): void {
    // No event handlers for accounts domain currently
    // This structure is here for future use

    // Acknowledge the parameter to avoid unused variable warning
    void eventBus;
  }
}
