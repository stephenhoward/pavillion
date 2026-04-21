/**
 * Unit tests for end date/time controls in event_recurrence.vue.
 *
 * Tests cover:
 * - initEndDateTime: initializes end date/time fields from schedule.eventEndTime
 * - onStartDateChange: auto-syncs end date unless manually overridden
 * - onEndDateManualChange: sets manual override flag
 * - buildEventEndTime / compileRecurrence: writes schedule.eventEndTime from form fields
 *
 * Audit notes (pv-j1pi.4):
 *   All tests in this file are RETAINED. They exercise the start/end date and
 *   start/end time inputs on `event_recurrence.vue` — not recurrence form
 *   internals. The epic DESIGN explicitly puts date/time inputs OUT OF SCOPE
 *   ("Changes to date/time inputs (stay inline on main editor)"), so these
 *   controls remain on the wrapper component after the sheet refactor and
 *   this file continues to mount it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('lucide-vue-next', () => ({
  Trash2: { template: '<span />' },
}));

import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid';

import { initI18Next } from '@/client/service/locale';
import { CalendarEventSchedule } from '@/common/model/events';
import EventRecurrence from '@/client/components/logged_in/calendar/event_recurrence.vue';

/**
 * Build a CalendarEventSchedule with optional eventEndTime pre-set.
 */
function makeSchedule(opts: {
  startISO?: string;
  eventEndTimeISO?: string | null;
} = {}): CalendarEventSchedule {
  const startDt = opts.startISO
    ? DateTime.fromISO(opts.startISO)
    : DateTime.fromISO('2026-05-01T09:00:00');

  const schedule = new CalendarEventSchedule(uuidv4(), startDt);

  if (opts.eventEndTimeISO) {
    schedule.eventEndTime = DateTime.fromISO(opts.eventEndTimeISO);
  }
  else {
    schedule.eventEndTime = null;
  }

  return schedule;
}

/**
 * Mount the EventRecurrence component with i18n plugin.
 */
function mountRecurrence(schedule: CalendarEventSchedule) {
  initI18Next();
  return mount(EventRecurrence, {
    global: {
      plugins: [
        [I18NextVue, { i18next }],
      ],
    },
    props: {
      schedule,
      index: 0,
      canRemove: false,
    },
  });
}

describe('event_recurrence.vue — initEndDateTime', () => {
  it('populates end date/time fields and sets manually-set flag when eventEndTime is set', async () => {
    const schedule = makeSchedule({
      startISO: '2026-05-01T09:00:00',
      eventEndTimeISO: '2026-05-01T11:30:00',
    });

    const wrapper = mountRecurrence(schedule);
    await nextTick();

    // findAll gives: [startDate, endDate] for type="date", [startTime, endTime] for type="time"
    const dateInputs = wrapper.findAll('input[type="date"]');
    const timeInputs = wrapper.findAll('input[type="time"]');

    // End date input (index 1) should reflect the eventEndTime date
    expect((dateInputs[1].element as HTMLInputElement).value).toBe('2026-05-01');

    // End time input (index 1) should reflect the eventEndTime time
    expect((timeInputs[1].element as HTMLInputElement).value).toBe('11:30');

    // Internal state should mark the end date as manually set
    const vm = wrapper.vm as any;
    expect(vm.state.eventEndDateManuallySet).toBe(true);
  });

  it('defaults end date to start date and clears time when eventEndTime is null', async () => {
    const schedule = makeSchedule({
      startISO: '2026-06-15T14:00:00',
      eventEndTimeISO: null,
    });

    const wrapper = mountRecurrence(schedule);
    await nextTick();

    const dateInputs = wrapper.findAll('input[type="date"]');
    const timeInputs = wrapper.findAll('input[type="time"]');

    // End date should default to start date
    expect((dateInputs[1].element as HTMLInputElement).value).toBe('2026-06-15');

    // End time should be empty
    expect((timeInputs[1].element as HTMLInputElement).value).toBe('');

    // Not manually set — auto-sync is active
    const vm = wrapper.vm as any;
    expect(vm.state.eventEndDateManuallySet).toBe(false);
  });
});

describe('event_recurrence.vue — onStartDateChange auto-sync', () => {
  it('updates end date when start date changes and eventEndDateManuallySet is false', async () => {
    const schedule = makeSchedule({
      startISO: '2026-05-01T09:00:00',
      eventEndTimeISO: null,
    });

    const wrapper = mountRecurrence(schedule);
    await nextTick();

    const vm = wrapper.vm as any;

    // Confirm auto-sync is initially active
    expect(vm.state.eventEndDateManuallySet).toBe(false);

    // Simulate user changing the start date input
    const dateInputs = wrapper.findAll('input[type="date"]');
    await dateInputs[0].setValue('2026-07-20');
    await dateInputs[0].trigger('input');
    await nextTick();

    // End date should have followed the start date
    expect(vm.state.eventEndDate).toBe('2026-07-20');
  });

  it('does not overwrite end date when start date changes after manual override', async () => {
    const schedule = makeSchedule({
      startISO: '2026-05-01T09:00:00',
      eventEndTimeISO: null,
    });

    const wrapper = mountRecurrence(schedule);
    await nextTick();

    const vm = wrapper.vm as any;

    // Manually change the end date to trigger the override flag
    const dateInputs = wrapper.findAll('input[type="date"]');
    await dateInputs[1].setValue('2026-08-10');
    await dateInputs[1].trigger('input');
    await nextTick();

    expect(vm.state.eventEndDateManuallySet).toBe(true);

    // Now change the start date
    await dateInputs[0].setValue('2026-09-01');
    await dateInputs[0].trigger('input');
    await nextTick();

    // End date must remain the manually chosen value
    expect(vm.state.eventEndDate).toBe('2026-08-10');
  });
});

describe('event_recurrence.vue — compileRecurrence writes eventEndTime', () => {
  it('sets schedule.eventEndTime when end date and time are both filled', async () => {
    const schedule = makeSchedule({
      startISO: '2026-05-01T09:00:00',
      eventEndTimeISO: null,
    });

    const wrapper = mountRecurrence(schedule);
    await nextTick();

    // End date already defaults to start date; just set end time
    const timeInputs = wrapper.findAll('input[type="time"]');
    await timeInputs[1].setValue('12:30');
    await timeInputs[1].trigger('input');
    await nextTick();

    // schedule.eventEndTime should now be set
    expect(schedule.eventEndTime).not.toBeNull();
    expect(schedule.eventEndTime!.toFormat('HH:mm')).toBe('12:30');
    expect(schedule.eventEndTime!.toFormat('yyyy-MM-dd')).toBe('2026-05-01');
  });

  it('leaves schedule.eventEndTime null when end time is not filled', async () => {
    const schedule = makeSchedule({
      startISO: '2026-05-01T09:00:00',
      eventEndTimeISO: null,
    });

    const wrapper = mountRecurrence(schedule);
    await nextTick();

    // Trigger a start date change without setting end time
    const dateInputs = wrapper.findAll('input[type="date"]');
    await dateInputs[0].setValue('2026-05-02');
    await dateInputs[0].trigger('input');
    await nextTick();

    expect(schedule.eventEndTime).toBeNull();
  });
});
