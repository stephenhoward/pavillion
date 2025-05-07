import { defineStore } from 'pinia';
import { CalendarEvent } from '@/common/model/events';

export const useEventStore = defineStore('events', {
  state: () => {
    return {
      events: [] as CalendarEvent[],
    };
  },
  actions: {
    addEvent(event: CalendarEvent) {
      this.events.push(event);
    },

    updateEvent(event: CalendarEvent) {
      const index = this.events.findIndex((e) => e.id === event.id );
      if ( index >= 0 ) {
        this.events[index] = event;
      }
      else {
        this.addEvent(event);
      }
    },
  },
});
