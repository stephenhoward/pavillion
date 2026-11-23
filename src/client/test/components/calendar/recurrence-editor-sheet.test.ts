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
          template: '<dialog aria-modal="true"><slot /></dialog>',
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

    const dialog = wrapper.find('dialog');
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

describe('RecurrenceEditorSheet.vue — end date in the schedule zone', () => {
  // A zone no test machine runs in, so a parse in the process zone shows.
  const ZONE = 'Asia/Tokyo';

  function weeklyInZone(): CalendarEventSchedule {
    const schedule = new CalendarEventSchedule();
    schedule.startDate = DateTime.fromISO('2026-10-27T10:15:00', { zone: ZONE });
    schedule.frequency = EventFrequency.WEEKLY;
    schedule.interval = 1;
    schedule.count = 0;
    return schedule;
  }

  it('shows a stored end date as its calendar date in the schedule zone', () => {
    const schedule = weeklyInZone();
    schedule.endDate = DateTime.fromISO('2026-12-31T00:00:00', { zone: ZONE });

    const wrapper = mountSheet(schedule);

    const dateInput = wrapper.find('input[type="date"]');
    expect((dateInput.element as HTMLInputElement).value).toBe('2026-12-31');
    wrapper.unmount();
  });

  it('reads a picked end date as midnight in the schedule zone', async () => {
    const schedule = weeklyInZone();
    schedule.endDate = null;

    const wrapper = mountSheet(schedule);

    await wrapper.find('input[type="date"]').setValue('2027-01-15');

    expect(schedule.endDate).not.toBeNull();
    expect(schedule.endDate!.zoneName).toBe(ZONE);
    expect(schedule.endDate!.toISO()).toBe('2027-01-15T00:00:00.000+09:00');
    wrapper.unmount();
  });
});

describe('RecurrenceEditorSheet.vue — defaults that produce a recurring event', () => {
  // A zone fixed in the test, never the runner's: Wednesday 22:00 here is
  // already Thursday in UTC, so a weekday read outside the zone yields TH.
  const ZONE = 'America/Los_Angeles';

  /**
   * A one-off event as event_recurrence.vue leaves it once the dates are
   * filled: no frequency, and endDate mirroring eventEndTime.
   */
  function oneOffSchedule(): CalendarEventSchedule {
    const schedule = new CalendarEventSchedule();
    schedule.startDate = DateTime.fromISO('2026-11-18T22:00:00', { zone: ZONE });
    schedule.eventEndTime = DateTime.fromISO('2026-11-18T23:00:00', { zone: ZONE });
    schedule.endDate = schedule.eventEndTime;
    return schedule;
  }

  function radio(wrapper: ReturnType<typeof mountSheet>, value: string): HTMLInputElement {
    return wrapper.find(`input[type="radio"][value="${value}"]`).element as HTMLInputElement;
  }

  function checkedWeekdays(wrapper: ReturnType<typeof mountSheet>): string[] {
    return wrapper.findAll('.week-parameters label')
      .filter(label => (label.find('input[type="checkbox"]').element as HTMLInputElement).checked)
      .map(label => label.text());
  }

  it('opens a one-off event on "never" when Weekly is chosen', async () => {
    const schedule = oneOffSchedule();
    const wrapper = mountSheet(schedule);

    await wrapper.find('select.frequency-select').setValue('weekly');

    expect(radio(wrapper, 'none').checked).toBe(true);
    expect(schedule.endDate).toBeNull();
    expect(schedule.count).toBe(0);
    wrapper.unmount();
  });

  it('ticks the start date\'s weekday in the schedule zone when Weekly is chosen', async () => {
    const schedule = oneOffSchedule();
    const wrapper = mountSheet(schedule);

    await wrapper.find('select.frequency-select').setValue('weekly');

    expect(checkedWeekdays(wrapper)).toEqual(['Wednesday']);
    expect(schedule.byDay).toEqual(['WE']);
    wrapper.unmount();
  });

  it('opens a one-off event on "never" when Daily is chosen', async () => {
    const schedule = oneOffSchedule();
    const wrapper = mountSheet(schedule);

    await wrapper.find('select.frequency-select').setValue('daily');

    expect(radio(wrapper, 'none').checked).toBe(true);
    expect(schedule.endDate).toBeNull();
    expect(schedule.count).toBe(0);
    wrapper.unmount();
  });

  it('shows 1 in the "after" input by default', async () => {
    const schedule = oneOffSchedule();
    const wrapper = mountSheet(schedule);

    await wrapper.find('select.frequency-select').setValue('weekly');

    const countInput = wrapper.find('input[type="number"][min="1"]');
    expect(countInput.exists()).toBe(true);
    expect((countInput.element as HTMLInputElement).value).toBe('1');
    wrapper.unmount();
  });

  it.each(['', '0'])('saves a count of 1 when the "after" input is set to %j', async (value) => {
    const schedule = oneOffSchedule();
    const wrapper = mountSheet(schedule);

    await wrapper.find('select.frequency-select').setValue('weekly');
    await wrapper.find('input[type="number"][min="1"]').setValue('5');
    await wrapper.find('input[type="number"][min="1"]').setValue(value);

    expect(radio(wrapper, 'after').checked).toBe(true);
    expect(schedule.count).toBe(1);
    wrapper.unmount();
  });

  it('opens an existing rule with no count and no end date on "never"', () => {
    const schedule = oneOffSchedule();
    schedule.frequency = EventFrequency.WEEKLY;
    schedule.interval = 1;
    schedule.byDay = ['WE'];
    schedule.count = 0;
    schedule.endDate = null;
    const wrapper = mountSheet(schedule);

    expect(radio(wrapper, 'none').checked).toBe(true);
    expect((wrapper.find('input[type="date"]').element as HTMLInputElement).value).toBe('');
    wrapper.unmount();
  });

  it('restores the one-off end date when frequency goes back to none', async () => {
    const schedule = oneOffSchedule();
    const wrapper = mountSheet(schedule);

    await wrapper.find('select.frequency-select').setValue('weekly');
    await wrapper.find('select.frequency-select').setValue('');

    expect(schedule.frequency).toBeNull();
    expect(schedule.count).toBe(0);
    expect(schedule.byDay).toEqual([]);
    expect(schedule.endDate).toBe(schedule.eventEndTime);
    wrapper.unmount();
  });

  it('opens an existing rule with an end date on "on" and compiles back the same end date', async () => {
    const schedule = oneOffSchedule();
    schedule.frequency = EventFrequency.WEEKLY;
    schedule.interval = 1;
    schedule.byDay = ['WE'];
    schedule.endDate = DateTime.fromISO('2026-12-31T00:00:00', { zone: ZONE });
    const wrapper = mountSheet(schedule);

    expect(radio(wrapper, 'on').checked).toBe(true);
    expect((wrapper.find('input[type="date"]').element as HTMLInputElement).value).toBe('2026-12-31');

    await wrapper.find('input[type="number"]').setValue('2');

    expect(schedule.endDate!.toISO()).toBe('2026-12-31T00:00:00.000-08:00');
    wrapper.unmount();
  });

  it('opens an existing rule with a count on "after N"', () => {
    const schedule = oneOffSchedule();
    schedule.frequency = EventFrequency.WEEKLY;
    schedule.interval = 1;
    schedule.byDay = ['WE'];
    schedule.endDate = null;
    schedule.count = 7;
    const wrapper = mountSheet(schedule);

    expect(radio(wrapper, 'after').checked).toBe(true);
    expect((wrapper.find('input[type="number"][min="1"]').element as HTMLInputElement).value).toBe('7');
    wrapper.unmount();
  });

  it('does not overwrite existing weekdays when the sheet recompiles', async () => {
    const schedule = oneOffSchedule();
    schedule.frequency = EventFrequency.WEEKLY;
    schedule.interval = 1;
    schedule.byDay = ['MO', 'FR'];
    schedule.endDate = null;
    const wrapper = mountSheet(schedule);

    await wrapper.find('select.frequency-select').setValue('weekly');

    expect(checkedWeekdays(wrapper)).toEqual(['Monday', 'Friday']);
    expect(schedule.byDay).toEqual(['MO', 'FR']);
    wrapper.unmount();
  });

  it('keeps "after 5" when frequency changes from Daily to Weekly', async () => {
    const schedule = oneOffSchedule();
    const wrapper = mountSheet(schedule);

    await wrapper.find('select.frequency-select').setValue('daily');
    await wrapper.find('input[type="number"][min="1"]').setValue('5');
    await wrapper.find('select.frequency-select').setValue('weekly');

    expect(radio(wrapper, 'after').checked).toBe(true);
    expect((wrapper.find('input[type="number"][min="1"]').element as HTMLInputElement).value).toBe('5');
    expect(schedule.count).toBe(5);
    expect(schedule.endDate).toBeNull();
    wrapper.unmount();
  });
});

describe('RecurrenceEditorSheet.vue — fewer-than-two-occurrences status line', () => {
  const ZONE = 'America/Los_Angeles';
  const WARNING = 'This rule makes fewer than two occurrences, so the event will not repeat.';

  function weeklySchedule(): CalendarEventSchedule {
    const schedule = new CalendarEventSchedule();
    schedule.startDate = DateTime.fromISO('2026-11-18T22:00:00', { zone: ZONE });
    schedule.eventEndTime = DateTime.fromISO('2026-11-18T23:00:00', { zone: ZONE });
    schedule.frequency = EventFrequency.WEEKLY;
    schedule.interval = 1;
    schedule.byDay = ['WE'];
    schedule.endDate = null;
    return schedule;
  }

  function status(wrapper: ReturnType<typeof mountSheet>) {
    return wrapper.find('[role="status"].recurrence-warning');
  }

  function doneButton(wrapper: ReturnType<typeof mountSheet>): HTMLButtonElement {
    return wrapper.find('.sheet-footer button').element as HTMLButtonElement;
  }

  it('shows the warning for "after 1" and keeps Done enabled', async () => {
    const schedule = weeklySchedule();
    const wrapper = mountSheet(schedule);

    await wrapper.find('input[type="number"][min="1"]').setValue('1');

    expect(status(wrapper).text()).toBe(WARNING);
    expect(status(wrapper).classes()).toContain('recurrence-warning--active');
    expect(doneButton(wrapper).disabled).toBe(false);
    wrapper.unmount();
  });

  it('is empty for "after 2"', async () => {
    const schedule = weeklySchedule();
    const wrapper = mountSheet(schedule);

    await wrapper.find('input[type="number"][min="1"]').setValue('2');

    expect(status(wrapper).exists()).toBe(true);
    expect(status(wrapper).text()).toBe('');
    expect(status(wrapper).classes()).not.toContain('recurrence-warning--active');
    wrapper.unmount();
  });

  it('shows the warning when the end date allows only the first occurrence', async () => {
    const schedule = weeklySchedule();
    const wrapper = mountSheet(schedule);

    await wrapper.find('input[type="date"]').setValue('2026-11-20');

    expect(status(wrapper).text()).toBe(WARNING);
    expect(doneButton(wrapper).disabled).toBe(false);
    wrapper.unmount();
  });

  it('is mounted and empty when frequency is none', () => {
    const schedule = new CalendarEventSchedule();
    schedule.startDate = DateTime.fromISO('2026-11-18T22:00:00', { zone: ZONE });
    const wrapper = mountSheet(schedule);

    expect(status(wrapper).exists()).toBe(true);
    expect(status(wrapper).text()).toBe('');
    expect(doneButton(wrapper).disabled).toBe(false);
    wrapper.unmount();
  });
});
