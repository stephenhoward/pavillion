/**
 * Tests for DST-safe timezone handling in event_recurrence.vue.
 *
 * Regression for: Recurring event instances show 1-hour time shift across DST boundary.
 * The 'Outdoor Yoga Class' appearing at 5:00 PM on Mar 2 and 6:00 PM on Mar 9 caused by
 * DateTime.fromISO() without timezone zone option — wall-clock time must be preserved
 * across DST transitions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { CalendarEventSchedule } from '@/common/model/events';
import { DateTime } from 'luxon';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { initI18Next } from '@/client/service/locale';
import EventRecurrence from '@/client/components/logged_in/calendar/event_recurrence.vue';

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

describe('event_recurrence.vue — DST-safe timezone handling', () => {
  it('sets startDate with the selected timezone zone when date and time are provided', async () => {
    const schedule = new CalendarEventSchedule();
    const wrapper = mountRecurrence(schedule);

    // Simulate user selecting a date/time and a specific timezone
    const dateInput = wrapper.find('input[type="date"]');
    const timeInput = wrapper.find('input[type="time"]');
    const tzSelect = wrapper.find('select.grid-input');

    await dateInput.setValue('2026-03-02');
    await timeInput.setValue('17:00');
    await tzSelect.setValue('America/New_York');

    // Trigger the update
    await dateInput.trigger('input');

    // The startDate should be a DateTime with the America/New_York zone
    expect(schedule.startDate).not.toBeNull();
    const dt = schedule.startDate as DateTime;

    // Wall-clock hour should be 17 in the selected timezone
    expect(dt.setZone('America/New_York').hour).toBe(17);
    // The zone name should be the IANA timezone, not UTC or local
    expect(dt.zoneName).toBe('America/New_York');
  });

  it('preserves wall-clock hour (17:00) across a DST boundary when timezone is set', async () => {
    const schedule = new CalendarEventSchedule();
    const wrapper = mountRecurrence(schedule);

    const dateInput = wrapper.find('input[type="date"]');
    const timeInput = wrapper.find('input[type="time"]');
    const tzSelect = wrapper.find('select.grid-input');

    // Set timezone to America/New_York before DST (EST, UTC-5)
    await tzSelect.setValue('America/New_York');
    await dateInput.setValue('2026-03-02');
    await timeInput.setValue('17:00');
    await dateInput.trigger('input');

    const preDstDate = schedule.startDate as DateTime;
    expect(preDstDate).not.toBeNull();

    // Verify wall-clock time is 17:00 in New York on Mar 2 (EST)
    const preDstNY = preDstDate.setZone('America/New_York');
    expect(preDstNY.hour).toBe(17);
    expect(preDstNY.minute).toBe(0);

    // Now simulate a date after DST transition (Mar 9, 2026 — US DST starts Mar 8)
    await dateInput.setValue('2026-03-09');
    await timeInput.setValue('17:00');
    await dateInput.trigger('input');

    const postDstDate = schedule.startDate as DateTime;
    expect(postDstDate).not.toBeNull();

    // Wall-clock time must still be 17:00 in New York — not shifted to 18:00
    const postDstNY = postDstDate.setZone('America/New_York');
    expect(postDstNY.hour).toBe(17);
    expect(postDstNY.minute).toBe(0);

    // The UTC offset should have changed (EST=-300 → EDT=-240) but wall clock stays the same
    expect(preDstNY.offset).toBe(-300); // UTC-5 (EST)
    expect(postDstNY.offset).toBe(-240); // UTC-4 (EDT)
  });

  it('falls back gracefully when date or time is empty', async () => {
    const schedule = new CalendarEventSchedule();
    const wrapper = mountRecurrence(schedule);

    // Only set date, not time
    const dateInput = wrapper.find('input[type="date"]');
    await dateInput.setValue('2026-03-02');
    await dateInput.trigger('input');

    // startDate should remain null because time is missing
    expect(schedule.startDate).toBeNull();
  });
});
