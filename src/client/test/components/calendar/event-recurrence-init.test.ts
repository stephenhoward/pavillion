/**
 * Tests for event_recurrence.vue initialization from existing schedule data.
 *
 * Regression for: Recurrence rule not copied to duplicate event.
 * When duplicating a recurring event, the recurrence section stays hidden
 * because state.showRecurrence is always initialized to false, even when
 * the schedule already has a frequency set.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { CalendarEvent, CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import { DateTime } from 'luxon';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { initI18Next } from '@/client/service/locale';
import EventRecurrence from '@/client/components/logged_in/calendar/event_recurrence.vue';
import { useEventDuplication } from '@/client/composables/useEventDuplication';

// Suppress lucide-vue-next import issues in test environment
vi.mock('lucide-vue-next', () => ({
  Trash2: {
    name: 'Trash2',
    template: '<span />',
  },
}));

const mountRecurrence = (schedule: CalendarEventSchedule) => {
  initI18Next();
  return mount(EventRecurrence, {
    global: {
      plugins: [[I18NextVue, { i18next }]],
      stubs: {
        Trash2: true,
      },
    },
    props: {
      schedule,
      canRemove: false,
    },
  });
};

describe('event_recurrence.vue — initialization from existing schedule data', () => {
  describe('showRecurrence state', () => {
    it('shows "Add recurrence" button when schedule has no frequency', () => {
      const schedule = new CalendarEventSchedule();
      const wrapper = mountRecurrence(schedule);

      expect(wrapper.find('.add-recurrence-btn').exists()).toBe(true);
      expect(wrapper.find('form.repeats').exists()).toBe(false);
    });

    it('shows recurrence form when schedule already has a frequency set', () => {
      const schedule = new CalendarEventSchedule('schedule-id');
      schedule.frequency = EventFrequency.WEEKLY;
      schedule.interval = 1;

      const wrapper = mountRecurrence(schedule);

      // Recurrence form should be visible — not hidden behind "Add recurrence" button
      expect(wrapper.find('form.repeats').exists()).toBe(true);
      expect(wrapper.find('.add-recurrence-btn').exists()).toBe(false);
    });

    it('shows recurrence form for daily frequency', () => {
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.DAILY;
      schedule.interval = 2;

      const wrapper = mountRecurrence(schedule);

      expect(wrapper.find('form.repeats').exists()).toBe(true);
    });

    it('shows recurrence form for monthly frequency', () => {
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.MONTHLY;
      schedule.interval = 1;

      const wrapper = mountRecurrence(schedule);

      expect(wrapper.find('form.repeats').exists()).toBe(true);
    });

    it('shows recurrence form for yearly frequency', () => {
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.YEARLY;
      schedule.interval = 1;

      const wrapper = mountRecurrence(schedule);

      expect(wrapper.find('form.repeats').exists()).toBe(true);
    });
  });

  describe('endType initialization', () => {
    it('initializes endType to "none" when schedule has no count or endDate', () => {
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.WEEKLY;
      schedule.interval = 1;
      schedule.count = 0;
      schedule.endDate = null;

      const wrapper = mountRecurrence(schedule);

      // The "never" radio should be selected
      const neverRadio = wrapper.find('input[type="radio"][value="none"]');
      expect(neverRadio.exists()).toBe(true);
      expect((neverRadio.element as HTMLInputElement).checked).toBe(true);
    });

    it('initializes endType to "after" when schedule has a count > 0', () => {
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.WEEKLY;
      schedule.interval = 1;
      schedule.count = 5;
      schedule.endDate = null;

      const wrapper = mountRecurrence(schedule);

      // The "after" radio should be selected
      const afterRadio = wrapper.find('input[type="radio"][value="after"]');
      expect(afterRadio.exists()).toBe(true);
      expect((afterRadio.element as HTMLInputElement).checked).toBe(true);
    });

    it('initializes endType to "on" when schedule has an endDate', () => {
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.WEEKLY;
      schedule.interval = 1;
      schedule.count = 0;
      schedule.endDate = DateTime.fromISO('2026-12-31');

      const wrapper = mountRecurrence(schedule);

      // The "on" radio should be selected
      const onRadio = wrapper.find('input[type="radio"][value="on"]');
      expect(onRadio.exists()).toBe(true);
      expect((onRadio.element as HTMLInputElement).checked).toBe(true);
    });
  });

  describe('weekday checkbox initialization', () => {
    it('initializes weekday checkboxes from byDay for weekly recurrence', () => {
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.WEEKLY;
      schedule.interval = 1;
      schedule.byDay = ['MO', 'WE', 'FR'];

      const wrapper = mountRecurrence(schedule);

      // The weekly parameters section should be visible
      const weekParams = wrapper.find('div.week-parameters');
      expect(weekParams.exists()).toBe(true);

      // MO, WE, FR checkboxes should be checked
      const checkboxes = weekParams.findAll('input[type="checkbox"]');

      // Verify the correct number of days are checked
      const checkedCheckboxes = checkboxes.filter(cb => (cb.element as HTMLInputElement).checked);
      expect(checkedCheckboxes).toHaveLength(3);
    });

    it('does not show weekday checkboxes for non-weekly frequency', () => {
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.DAILY;
      schedule.interval = 1;
      schedule.byDay = [];

      const wrapper = mountRecurrence(schedule);

      const weekParams = wrapper.find('div.week-parameters');
      expect(weekParams.exists()).toBe(false);
    });
  });

  describe('useEventDuplication — schedule recurrence preservation', () => {
    const { stripEventForDuplication } = useEventDuplication();

    it('preserves frequency in duplicated schedule', () => {
      const sourceEvent = new CalendarEvent('eventId', 'calendarId');
      const schedule = new CalendarEventSchedule('sched-id', DateTime.now(), DateTime.now().plus({ hours: 1 }));
      schedule.frequency = EventFrequency.WEEKLY;
      schedule.interval = 2;
      schedule.byDay = ['MO', 'WE'];
      schedule.count = 0;
      sourceEvent.schedules = [schedule];

      const duplicatedEvent = stripEventForDuplication(sourceEvent);

      expect(duplicatedEvent.schedules).toHaveLength(1);
      const dupSchedule = duplicatedEvent.schedules[0];
      expect(dupSchedule.id).toBe(''); // ID cleared
      expect(dupSchedule.frequency).toBe(EventFrequency.WEEKLY); // frequency preserved
      expect(dupSchedule.interval).toBe(2); // interval preserved
      expect(dupSchedule.byDay).toEqual(['MO', 'WE']); // byDay preserved
    });

    it('preserves count in duplicated schedule', () => {
      const sourceEvent = new CalendarEvent('eventId', 'calendarId');
      const schedule = new CalendarEventSchedule('sched-id', DateTime.now());
      schedule.frequency = EventFrequency.DAILY;
      schedule.interval = 1;
      schedule.count = 10;
      sourceEvent.schedules = [schedule];

      const duplicatedEvent = stripEventForDuplication(sourceEvent);

      expect(duplicatedEvent.schedules[0].count).toBe(10);
    });
  });
});
