/**
 * Accessible-name tests for the schedule grid in event_recurrence.vue.
 *
 * Each Date, Time, End Date, End Time and Timezone control must be
 * programmatically associated with its visible label, and each schedule's
 * grid must be a group named by its "Schedule N" header. Several schedules
 * render at once in the event editor, so ids must be unique per instance.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { DateTime } from 'luxon';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { initI18Next } from '@/client/service/locale';
import { CalendarEventSchedule } from '@/common/model/events';
import EventRecurrence from '@/client/components/logged_in/calendar/event_recurrence.vue';

vi.mock('lucide-vue-next', () => ({
  Trash2: { name: 'Trash2', template: '<span />' },
  CalendarSync: { name: 'CalendarSync', template: '<span />' },
}));

const EXPECTED_LABELS = ['Date', 'Time', 'End Date', 'End Time', 'Timezone'];

const makeSchedule = (): CalendarEventSchedule => {
  const schedule = new CalendarEventSchedule();
  schedule.startDate = DateTime.fromISO('2026-06-01T10:00:00', { zone: 'UTC' });
  schedule.eventEndTime = DateTime.fromISO('2026-06-01T12:00:00', { zone: 'UTC' });
  return schedule;
};

let wrapper: VueWrapper | null = null;

const mountSchedules = (count: number): HTMLElement => {
  initI18Next();
  const schedules = Array.from({ length: count }, makeSchedule);
  const Host = defineComponent({
    setup() {
      return () => h('div', schedules.map((schedule, index) =>
        h(EventRecurrence, { key: index, schedule, index, canRemove: count > 1 }),
      ));
    },
  });
  wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [[I18NextVue, { i18next }]],
      stubs: { RecurrenceEditorSheet: true },
    },
  });
  return wrapper.element as HTMLElement;
};

/**
 * Returns the accessible name of a form control from its associated labels,
 * aria-labelledby or aria-label. Placeholder and title are deliberately not
 * consulted: they are not acceptable names for these controls.
 */
const accessibleName = (el: HTMLElement): string => {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    return labelledBy.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim();
  }
  const ariaLabel = el.getAttribute('aria-label')?.trim();
  if (ariaLabel) {
    return ariaLabel;
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length > 0) {
    return Array.from(labels).map((label) => label.textContent?.trim() ?? '').join(' ').trim();
  }
  return '';
};

const unnamedControls = (root: HTMLElement): string[] => {
  const controls = root.querySelectorAll<HTMLElement>(
    'input:not([type=hidden]), select, textarea',
  );
  return Array.from(controls)
    .filter((el) => accessibleName(el) === '')
    .map((el) => el.id || el.getAttribute('name') || el.outerHTML.slice(0, 80));
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('event_recurrence.vue — schedule grid labels', () => {
  it.each([1, 2])('associates every grid label with its control (%i schedule(s))', (count) => {
    const root = mountSchedules(count);
    const grids = root.querySelectorAll<HTMLElement>('.schedule-grid');
    expect(grids).toHaveLength(count);

    grids.forEach((grid) => {
      const labels = Array.from(grid.querySelectorAll('label.grid-label'));
      expect(labels.map((l) => l.textContent?.trim())).toEqual(EXPECTED_LABELS);

      labels.forEach((label) => {
        const forId = label.getAttribute('for');
        expect(forId, `label "${label.textContent?.trim()}" has no for`).toBeTruthy();
        const control = document.getElementById(forId!);
        expect(control, `no control with id ${forId}`).not.toBeNull();
        expect(grid.contains(control)).toBe(true);
        expect(['INPUT', 'SELECT']).toContain(control!.tagName);
      });
    });
  });

  it('derives the five control ids from one per-instance base', () => {
    const root = mountSchedules(1);
    const grid = root.querySelector<HTMLElement>('.schedule-grid')!;
    const ids = Array.from(grid.querySelectorAll('label.grid-label'))
      .map((l) => l.getAttribute('for')!);
    const base = ids[0].replace(/-start-date$/, '');
    expect(ids).toEqual([
      `${base}-start-date`,
      `${base}-start-time`,
      `${base}-end-date`,
      `${base}-end-time`,
      `${base}-timezone`,
    ]);
  });

  it('produces no duplicate ids across two schedules', () => {
    const root = mountSchedules(2);
    const ids = Array.from(root.querySelectorAll('[id]')).map((el) => el.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names each grid as a group by its "Schedule N" header', () => {
    const root = mountSchedules(2);
    const grids = Array.from(root.querySelectorAll<HTMLElement>('.schedule-grid'));
    expect(grids).toHaveLength(2);

    grids.forEach((grid, index) => {
      expect(grid.getAttribute('role')).toBe('group');
      const labelledBy = grid.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const header = document.getElementById(labelledBy!);
      expect(header).not.toBeNull();
      expect(header!.textContent?.trim()).toBe(`Schedule ${index + 1}`);
    });
  });

  it.each([1, 2])('gives every visible form control a non-empty name (%i schedule(s))', (count) => {
    const root = mountSchedules(count);
    expect(unnamedControls(root)).toEqual([]);
  });
});
