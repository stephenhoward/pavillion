/**
 * Smoke tests for RecurrenceEditorSheet.vue.
 *
 * This leaf (pv-j1pi.3) only scaffolds the new component. Full behavior
 * tests (DST, init, end-time) migrate from event-recurrence-*.test.ts in
 * pv-j1pi.4. These smoke tests verify that the sheet mounts, renders its
 * title, and exposes the frequency dropdown.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { initI18Next } from '@/client/service/locale';
import { CalendarEventSchedule } from '@/common/model/events';
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
