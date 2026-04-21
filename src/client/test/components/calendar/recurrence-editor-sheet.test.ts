/**
 * Unit tests for RecurrenceEditorSheet.vue.
 *
 * This file owns form-behavior coverage for the recurrence editor after the
 * inline form is removed from event_recurrence.vue (pv-j1pi.5). Tests migrated
 * from event-recurrence-init.test.ts in pv-j1pi.4 cover:
 *
 *   - Frequency-driven form visibility (daily / weekly / monthly / yearly)
 *   - End-type radio initialization (none / after / on)
 *   - Weekday checkbox initialization from byDay
 *
 * Note: DST / startDate / eventEndTime tests are NOT migrated here — those
 * exercise the date/time/timezone inputs which stay on event_recurrence.vue
 * (explicitly out of scope per the epic DESIGN section). They remain in
 * event-recurrence-dst.test.ts and event-recurrence-end-time.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { initI18Next } from '@/client/service/locale';
import { CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import RecurrenceEditorSheet from '@/client/components/logged_in/calendar/RecurrenceEditorSheet.vue';

const mountSheet = (schedule: CalendarEventSchedule) => {
  initI18Next();
  return mount(RecurrenceEditorSheet, {
    global: {
      plugins: [[I18NextVue, { i18next }]],
      stubs: {
        // Stub the Sheet wrapper so happy-dom doesn't need to implement
        // HTMLDialogElement.showModal(). The stub renders slot content
        // inside a role=dialog element so ARIA-oriented assertions still
        // work.
        Sheet: {
          template: '<div role="dialog" aria-modal="true"><slot /></div>',
          props: ['title'],
          emits: ['close'],
        },
      },
    },
    props: {
      schedule,
    },
  });
};

describe('RecurrenceEditorSheet.vue — smoke tests', () => {
  it('mounts without errors', () => {
    const schedule = new CalendarEventSchedule();
    const wrapper = mountSheet(schedule);

    expect(wrapper.exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders the sheet as visible (role=dialog)', () => {
    const schedule = new CalendarEventSchedule();
    const wrapper = mountSheet(schedule);

    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes('aria-modal')).toBe('true');
    wrapper.unmount();
  });

  it('exposes an accessible frequency dropdown', () => {
    const schedule = new CalendarEventSchedule();
    const wrapper = mountSheet(schedule);

    const frequencySelect = wrapper.find('select.frequency-select');
    expect(frequencySelect.exists()).toBe(true);

    // The associated label should exist and point at the same input via for/id.
    const selectId = frequencySelect.attributes('id');
    expect(selectId).toBeTruthy();

    const label = wrapper.find(`label[for="${selectId}"]`);
    expect(label.exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('RecurrenceEditorSheet.vue — frequency-driven form visibility', () => {
  // Migrated from event-recurrence-init.test.ts (pv-j1pi.4).
  // The sheet always renders its form; these assertions mirror the
  // "recurrence form is visible for <frequency>" checks from the inline
  // form by confirming that frequency-dependent fieldsets render.
  it('renders the form when schedule already has a weekly frequency set', () => {
    const schedule = new CalendarEventSchedule('schedule-id');
    schedule.frequency = EventFrequency.WEEKLY;
    schedule.interval = 1;

    const wrapper = mountSheet(schedule);

    expect(wrapper.find('form.repeats').exists()).toBe(true);
    // Weekly frequency exposes the weekday fieldset.
    expect(wrapper.find('.week-parameters').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders the form for daily frequency', () => {
    const schedule = new CalendarEventSchedule();
    schedule.frequency = EventFrequency.DAILY;
    schedule.interval = 2;

    const wrapper = mountSheet(schedule);

    expect(wrapper.find('form.repeats').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders the form for monthly frequency', () => {
    const schedule = new CalendarEventSchedule();
    schedule.frequency = EventFrequency.MONTHLY;
    schedule.interval = 1;

    const wrapper = mountSheet(schedule);

    expect(wrapper.find('form.repeats').exists()).toBe(true);
    // Monthly frequency exposes the monthly-weekday grid.
    expect(wrapper.find('.month-parameters').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders the form for yearly frequency', () => {
    const schedule = new CalendarEventSchedule();
    schedule.frequency = EventFrequency.YEARLY;
    schedule.interval = 1;

    const wrapper = mountSheet(schedule);

    expect(wrapper.find('form.repeats').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('RecurrenceEditorSheet.vue — endType initialization', () => {
  // Migrated from event-recurrence-init.test.ts (pv-j1pi.4).
  it('initializes endType to "none" when schedule has no count or endDate', () => {
    const schedule = new CalendarEventSchedule();
    schedule.frequency = EventFrequency.WEEKLY;
    schedule.interval = 1;
    schedule.count = 0;
    schedule.endDate = null;

    const wrapper = mountSheet(schedule);

    // The "never" radio should be selected
    const neverRadio = wrapper.find('input[type="radio"][value="none"]');
    expect(neverRadio.exists()).toBe(true);
    expect((neverRadio.element as HTMLInputElement).checked).toBe(true);
    wrapper.unmount();
  });

  it('initializes endType to "after" when schedule has a count > 0', () => {
    const schedule = new CalendarEventSchedule();
    schedule.frequency = EventFrequency.WEEKLY;
    schedule.interval = 1;
    schedule.count = 5;
    schedule.endDate = null;

    const wrapper = mountSheet(schedule);

    // The "after" radio should be selected
    const afterRadio = wrapper.find('input[type="radio"][value="after"]');
    expect(afterRadio.exists()).toBe(true);
    expect((afterRadio.element as HTMLInputElement).checked).toBe(true);
    wrapper.unmount();
  });

  it('initializes endType to "on" when schedule has an endDate', () => {
    const schedule = new CalendarEventSchedule();
    schedule.frequency = EventFrequency.WEEKLY;
    schedule.interval = 1;
    schedule.count = 0;
    schedule.endDate = DateTime.fromISO('2026-12-31');

    const wrapper = mountSheet(schedule);

    // The "on" radio should be selected
    const onRadio = wrapper.find('input[type="radio"][value="on"]');
    expect(onRadio.exists()).toBe(true);
    expect((onRadio.element as HTMLInputElement).checked).toBe(true);
    wrapper.unmount();
  });
});

describe('RecurrenceEditorSheet.vue — weekday checkbox initialization', () => {
  // Migrated from event-recurrence-init.test.ts (pv-j1pi.4).
  it('initializes weekday checkboxes from byDay for weekly recurrence', () => {
    const schedule = new CalendarEventSchedule();
    schedule.frequency = EventFrequency.WEEKLY;
    schedule.interval = 1;
    schedule.byDay = ['MO', 'WE', 'FR'];

    const wrapper = mountSheet(schedule);

    // The weekly parameters section should be visible
    const weekParams = wrapper.find('.week-parameters');
    expect(weekParams.exists()).toBe(true);

    // MO, WE, FR checkboxes should be checked
    const checkboxes = weekParams.findAll('input[type="checkbox"]');

    // Verify the correct number of days are checked
    const checkedCheckboxes = checkboxes.filter(cb => (cb.element as HTMLInputElement).checked);
    expect(checkedCheckboxes).toHaveLength(3);
    wrapper.unmount();
  });

  it('does not show weekday checkboxes for non-weekly frequency', () => {
    const schedule = new CalendarEventSchedule();
    schedule.frequency = EventFrequency.DAILY;
    schedule.interval = 1;
    schedule.byDay = [];

    const wrapper = mountSheet(schedule);

    const weekParams = wrapper.find('.week-parameters');
    expect(weekParams.exists()).toBe(false);
    wrapper.unmount();
  });
});
