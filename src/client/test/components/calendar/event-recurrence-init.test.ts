/**
 * Tests for event_recurrence.vue initialization from existing schedule data.
 *
 * Regression for: Recurrence rule not copied to duplicate event.
 * When duplicating a recurring event, the recurrence section stays hidden
 * because state.showRecurrence is always initialized to false, even when
 * the schedule already has a frequency set.
 *
 * Audit notes (pv-j1pi.4):
 *   - Form-behavior tests (endType init, weekday checkboxes) were MIGRATED to
 *     `recurrence-editor-sheet.test.ts` because they exercise recurrence form
 *     internals that now live on `RecurrenceEditorSheet.vue`.
 *   - The remaining tests stay here because they exercise `event_recurrence.vue`-
 *     level behavior (trigger rendering / form visibility toggle) or composable
 *     logic (`useEventDuplication`) that is independent of the sheet refactor.
 *     Each retained block is annotated below.
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
    // Retained: exercises event_recurrence.vue-level trigger rendering (the
    // "Add recurrence" button) — not form internals. After pv-j1pi.5 this
    // continues to guard the inline-vs-trigger toggle on the wrapper component.
    it('shows "Add recurrence" button when schedule has no frequency', () => {
      const schedule = new CalendarEventSchedule();
      const wrapper = mountRecurrence(schedule);

      expect(wrapper.find('.add-recurrence-btn').exists()).toBe(true);
      expect(wrapper.find('form.repeats').exists()).toBe(false);
    });

    // Retained: exercises event_recurrence.vue's form-vs-button visibility
    // toggle (the "Add recurrence" button is NOT shown when frequency is
    // already set). Form-internals (weekday/endType assertions) migrated to
    // recurrence-editor-sheet.test.ts.
    it('shows recurrence form when schedule already has a frequency set', () => {
      const schedule = new CalendarEventSchedule('schedule-id');
      schedule.frequency = EventFrequency.WEEKLY;
      schedule.interval = 1;

      const wrapper = mountRecurrence(schedule);

      // Recurrence form should be visible — not hidden behind "Add recurrence" button
      expect(wrapper.find('form.repeats').exists()).toBe(true);
      expect(wrapper.find('.add-recurrence-btn').exists()).toBe(false);
    });

    // Retained: exercises event_recurrence.vue's form visibility for daily
    // frequency. Migrated to recurrence-editor-sheet.test.ts as a mirror
    // assertion against the sheet component.
    it('shows recurrence form for daily frequency', () => {
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.DAILY;
      schedule.interval = 2;

      const wrapper = mountRecurrence(schedule);

      expect(wrapper.find('form.repeats').exists()).toBe(true);
    });

    // Retained: same as above for monthly.
    it('shows recurrence form for monthly frequency', () => {
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.MONTHLY;
      schedule.interval = 1;

      const wrapper = mountRecurrence(schedule);

      expect(wrapper.find('form.repeats').exists()).toBe(true);
    });

    // Retained: same as above for yearly.
    it('shows recurrence form for yearly frequency', () => {
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.YEARLY;
      schedule.interval = 1;

      const wrapper = mountRecurrence(schedule);

      expect(wrapper.find('form.repeats').exists()).toBe(true);
    });
  });

  // endType initialization tests MIGRATED to recurrence-editor-sheet.test.ts
  // (pv-j1pi.4). These three tests exercised form-internal radio state that
  // now lives on RecurrenceEditorSheet.vue. The inline form still contains
  // the same controls (until pv-j1pi.5), but canonical coverage has moved
  // to the sheet test file to avoid duplicate assertions.

  // weekday checkbox initialization tests MIGRATED to
  // recurrence-editor-sheet.test.ts (pv-j1pi.4). Same rationale as above.

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
