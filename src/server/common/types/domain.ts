import { EventEmitter } from 'events';

export interface DomainDependencies {
  db: any; // Use existing db type
  eventBus: EventEmitter;
  [key: string]: any; // For domain-specific dependencies
}

export interface DomainInterface {
  // Marker interface for internal APIs
}

export interface DomainEventHandlers {
  install(eventBus: EventEmitter): void;
}
