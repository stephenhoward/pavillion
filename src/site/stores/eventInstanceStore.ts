import { defineStore } from 'pinia';
import CalendarEventInstance from '@/common/model/event_instance';

export const useEventInstanceStore = defineStore('eventInstances', {
  state: () => {
    return {
      instances: [] as CalendarEventInstance[],
    };
  },
  actions: {
    /**
     * Adds a new calendar event to the store.
     *
     * @param instance - The event to add to the store
     */
    addEvent(instance: CalendarEventInstance) {
      this.instances.push(instance);
    },

    /**
     * Set events in the store
     * @param instances - The events to set in the store
     */
    setEvents(instances: CalendarEventInstance[]) {
      this.instances = instances;
    },
  },
});
