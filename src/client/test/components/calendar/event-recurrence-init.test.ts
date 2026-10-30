/**
 * Tests for event_recurrence.vue initialization from existing schedule data.
 *
 * Regression for: Recurrence rule not copied to duplicate event.
 * When duplicating a recurring event, the summary + "Edit recurrence"
 * trigger must reflect the existing frequency rather than showing the
 * "Add recurrence" trigger (as it would if the schedule were empty).
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
import { describe, it, expect, vi, afterEach } from 'vitest';
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
  CalendarSync: {
    name: 'CalendarSync',
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
        // Stub the sheet so these tests stay focused on wrapper-level
        // trigger rendering without mounting the full sheet + its dialog.
        RecurrenceEditorSheet: true,
      },
    },
    props: {
      schedule,
      canRemove: false,
    },
  });
};

/**
 * Finds the single recurrence trigger button (Add/Edit recurrence) rendered
 * on event_recurrence.vue. Since pv-j1pi.5 the trigger is a native
 * `<button class="btn btn--secondary">` inside `.recurrence-summary`.
 */
const findRecurrenceTrigger = (wrapper: ReturnType<typeof mountRecurrence>) => {
  return wrapper.find('.recurrence-summary button.btn--secondary');
};

describe('event_recurrence.vue — initialization from existing schedule data', () => {
  describe('recurrence trigger state', () => {
    // Retained: exercises event_recurrence.vue-level trigger rendering (the
    // "Add recurrence" button) — not form internals. After pv-j1pi.5 this
    // continues to guard the summary/trigger rendering on the wrapper
    // component. Assertion migrated from `.add-recurrence-btn` / `form.repeats`
    // to the new `.btn.btn--secondary` trigger + absence of mounted sheet.
    it('shows "Add recurrence" trigger when schedule has no frequency', () => {
      const schedule = new CalendarEventSchedule();
      const wrapper = mountRecurrence(schedule);

      const trigger = findRecurrenceTrigger(wrapper);
      expect(trigger.exists()).toBe(true);
      expect(trigger.text()).toContain('Add recurrence');
      // No summary text should render when frequency is unset
      expect(wrapper.find('.recurrence-summary .summary-text').exists()).toBe(false);
      // Sheet is not mounted until the trigger is clicked
      expect(wrapper.findComponent({ name: 'RecurrenceEditorSheet' }).exists()).toBe(false);
    });

    // Retained: exercises event_recurrence.vue's summary/trigger rendering
    // when a frequency is already set. Assertion migrated to check for the
    // "Edit recurrence" trigger + summary text rather than the inline form.
    // Also asserts rendered summary content + schedule header to catch
    // i18n key-routing regressions (e.g. accidental prefixed `t` on the
    // utility call would surface here as a raw key string).
    it('shows "Edit recurrence" trigger and summary when schedule already has a frequency set', () => {
      const schedule = new CalendarEventSchedule('schedule-id');
      schedule.frequency = EventFrequency.WEEKLY;
      schedule.interval = 1;

      const wrapper = mountRecurrence(schedule);

      const trigger = findRecurrenceTrigger(wrapper);
      expect(trigger.exists()).toBe(true);
      expect(trigger.text()).toContain('Edit recurrence');
      expect(wrapper.find('.recurrence-summary .summary-text').text()).toBe('Every week');
      expect(wrapper.find('.schedule-header span').text()).toBe('Schedule 1');
    });

    // Retained: same as above for daily.
    it('shows summary + edit trigger for daily frequency', () => {
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.DAILY;
      schedule.interval = 2;

      const wrapper = mountRecurrence(schedule);

      expect(wrapper.find('.recurrence-summary .summary-text').text()).toBe('Every 2 days');
      expect(findRecurrenceTrigger(wrapper).text()).toContain('Edit recurrence');
    });

    // Retained: same as above for monthly.
    it('shows summary + edit trigger for monthly frequency', () => {
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.MONTHLY;
      schedule.interval = 1;

      const wrapper = mountRecurrence(schedule);

      expect(wrapper.find('.recurrence-summary .summary-text').text()).toBe('Monthly');
      expect(findRecurrenceTrigger(wrapper).text()).toContain('Edit recurrence');
    });

    // Retained: same as above for yearly.
    it('shows summary + edit trigger for yearly frequency', () => {
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.YEARLY;
      schedule.interval = 1;

      const wrapper = mountRecurrence(schedule);

      expect(wrapper.find('.recurrence-summary .summary-text').text()).toBe('Yearly');
      expect(findRecurrenceTrigger(wrapper).text()).toContain('Edit recurrence');
    });

    // Added in pv-j1pi.5: clicking the trigger must mount the sheet.
    it('mounts RecurrenceEditorSheet when the trigger is clicked', async () => {
      const schedule = new CalendarEventSchedule();
      const wrapper = mountRecurrence(schedule);

      expect(wrapper.findComponent({ name: 'RecurrenceEditorSheet' }).exists()).toBe(false);

      await findRecurrenceTrigger(wrapper).trigger('click');

      expect(wrapper.findComponent({ name: 'RecurrenceEditorSheet' }).exists()).toBe(true);
    });
  });

  describe('timezone select initialization', () => {
    const BROWSER_ZONE = 'America/New_York';

    /**
     * Stubs the browser zone that getLocalTimezone() reads, leaving every
     * other Intl.DateTimeFormat behaviour (Luxon formatting) untouched.
     */
    const stubBrowserZone = (zone: string) => {
      const original = Intl.DateTimeFormat.prototype.resolvedOptions;
      vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...original.call(this), timeZone: zone };
      });
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const findInputs = (wrapper: ReturnType<typeof mountRecurrence>) => ({
      zone: wrapper.find('select.grid-input').element as HTMLSelectElement,
      date: wrapper.find('input[type="date"]').element as HTMLInputElement,
      time: wrapper.find('input[type="time"]').element as HTMLInputElement,
    });

    it('selects the loaded schedule\'s zone, not the browser zone', () => {
      stubBrowserZone(BROWSER_ZONE);
      const start = DateTime.fromISO('2026-10-27T10:15', { zone: 'America/Los_Angeles' });
      const schedule = new CalendarEventSchedule('sched-la', start);

      const inputs = findInputs(mountRecurrence(schedule));

      expect(inputs.zone.value).toBe('America/Los_Angeles');
      expect(inputs.date.value).toBe('2026-10-27');
      expect(inputs.time.value).toBe('10:15');
    });

    it('keeps the instant when the schedule is re-saved without edits to the time', async () => {
      stubBrowserZone(BROWSER_ZONE);
      const start = DateTime.fromISO('2026-10-27T10:15', { zone: 'America/Los_Angeles' });
      const schedule = new CalendarEventSchedule('sched-la', start);
      const wrapper = mountRecurrence(schedule);

      // Any edit runs syncScheduleFromDateTime, which rebuilds startDate from
      // the displayed digits in the selected zone.
      await wrapper.find('select.grid-input').trigger('change');

      expect(schedule.startDate?.zoneName).toBe('America/Los_Angeles');
      expect(schedule.startDate?.toMillis()).toBe(start.toMillis());
    });

    it('falls back to the browser zone, showing the time in it, when the schedule zone is not offered', () => {
      stubBrowserZone(BROWSER_ZONE);
      // 'UTC' is absent from Intl.supportedValuesOf('timeZone') in current engines.
      const start = DateTime.fromISO('2026-10-27T17:15:00Z', { zone: 'UTC' });
      const schedule = new CalendarEventSchedule('sched-utc', start);

      const inputs = findInputs(mountRecurrence(schedule));

      expect(inputs.zone.value).toBe(BROWSER_ZONE);
      expect(inputs.time.value).toBe('13:15');
    });

    it('uses the browser zone for a schedule with no start date', () => {
      stubBrowserZone(BROWSER_ZONE);

      const inputs = findInputs(mountRecurrence(new CalendarEventSchedule()));

      expect(inputs.zone.value).toBe(BROWSER_ZONE);
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
