import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';
import CalendarInterface from '../interface';

export default class CalendarEventHandlers implements DomainEventHandlers {
  private service: CalendarInterface;

  constructor(service: CalendarInterface) {
    this.service = service;
  }

  install(eventBus: EventEmitter): void {
    eventBus.on('eventCreated', async (e) => this.service.buildEventInstances(e.event));
    eventBus.on('eventUpdated', async (e) => this.service.buildEventInstances(e.event));
    eventBus.on('eventDeleted', async (e) => this.service.removeEventInstances(e.event));
  }
}
