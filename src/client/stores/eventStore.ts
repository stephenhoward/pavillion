import { defineStore } from 'pinia'
import { CalendarEvent } from '../../common/model/events';

export const useEventStore = defineStore('events', {
    state: () => ({
        events: [] as CalendarEvent[]
    }),
    actions: {
        addEvent(event: CalendarEvent) {
            this.events.push(event);
        },
        
        updateEvent(event: CalendarEvent) {
            const index = this.events.findIndex((e) => e.id === event.id);
            if ( index ) {
                this.events[index] = event;
            }
            else {
                this.addEvent(event);
            }
        }
    }
});
