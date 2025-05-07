import { EventEmitter } from 'events';

class EventProxy extends EventEmitter {
  constructor() {
    super();
  }

  proxyEvents(source: EventEmitter, events: string[]): void {
    for (let event of events) {
      source.on(event, (...args) => { this.emit(event, ...args); });
    }
  }

}

export default EventProxy;
