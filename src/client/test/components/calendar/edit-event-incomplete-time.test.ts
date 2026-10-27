import { expect, describe, it, afterEach, beforeEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, RouteRecordRaw } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';
import { nextTick } from 'vue';
import { flushPromises, DOMWrapper } from '@vue/test-utils';

import { Calendar } from '@/common/model/calendar';
import { mountComponent } from '@/client/test/lib/vue';
import EditEvent from '@/client/components/logged_in/calendar/edit_event.vue';
import CalendarService from '@/client/service/calendar';

vi.mock('@/client/stores/calendarStore', () => ({
  useCalendarStore: () => ({
    selectedCalendar: null,
    setSelectedCalendar: vi.fn(),
    calendars: [],
    addCalendar: vi.fn(),
  }),
}));

vi.mock('@/client/service/category', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      getEventCategories: vi.fn().mockResolvedValue([]),
      assignCategoriesToEvent: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('@/client/service/location', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      getLocations: vi.fn().mockResolvedValue([]),
      createLocation: vi.fn().mockResolvedValue({}),
    };
  }),
}));

const routes: RouteRecordRaw[] = [
  { path: '/calendar', component: {}, name: 'calendars' },
  { path: '/calendar/:calendar', component: {}, name: 'calendar' },
  { path: '/event', component: EditEvent, name: 'event_new' },
];

/**
 * jsdom never reports a partially typed native time input, so force the
 * state a browser reports when, say, only the hour and minutes are entered:
 * the value is empty and validity.badInput is true.
 */
const forceIncomplete = (input: DOMWrapper<HTMLInputElement>) => {
  Object.defineProperty(input.element, 'validity', {
    configurable: true,
    value: { badInput: true, valid: false },
  });
  input.element.value = '';
};

const mountEditor = async () => {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/event');
  await router.isReady();

  const calendar = new Calendar('testId', 'testName');
  calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });
  sinon.stub(CalendarService.prototype, 'loadCalendars').resolves([calendar]);

  const pinia = createPinia();
  setActivePinia(pinia);

  // Attached to the live document: the assertions read document.activeElement
  // and resolve aria-describedby by id, neither of which works detached.
  const host = document.createElement('div');
  document.body.appendChild(host);

  const wrapper = mountComponent(EditEvent, router, {
    pinia,
    provide: { site_config: { settings: () => ({}) } },
    stubs: {
      languagePicker: true,
      ImageUpload: true,
      CategorySelector: true,
    },
    attachTo: host,
  });

  await flushPromises();
  await nextTick();
  await nextTick();

  return wrapper;
};

const expectFieldLevelError = (input: DOMWrapper<HTMLInputElement>) => {
  expect(input.attributes('aria-invalid')).toBe('true');
  expect(input.classes()).toContain('field-input--error');

  const describedBy = input.attributes('aria-describedby');
  expect(describedBy).toBeTruthy();
  const errorElement = document.getElementById(describedBy as string);
  expect(errorElement).not.toBeNull();
  expect(errorElement?.textContent?.trim().length).toBeGreaterThan(0);
};

describe('Incomplete native time input', () => {
  let wrapper: any = null;

  beforeEach(() => {
    sinon.restore();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
      await nextTick();
    }
    document.body.innerHTML = '';
  });

  it('marks the incomplete start time on save and focuses it rather than the date input', async () => {
    wrapper = await mountEditor();

    await wrapper.find('#event-name-en').setValue('Titled event');
    const startTime = wrapper.find('.schedule-list input[type="time"]');
    expect(startTime.exists()).toBe(true);
    forceIncomplete(startTime);

    await wrapper.find('form').trigger('submit');
    await flushPromises();
    await nextTick();

    expectFieldLevelError(startTime);
    expect(document.activeElement).toBe(startTime.element);
    expect(document.activeElement).not.toBe(wrapper.find('.schedule-list input[type="date"]').element);
    // The group message for the genuinely-empty case still renders.
    expect(wrapper.find('#event-schedule-error').exists()).toBe(true);
  });

  it('marks the incomplete start time on blur, before any save', async () => {
    wrapper = await mountEditor();

    const startTime = wrapper.find('.schedule-list input[type="time"]');
    forceIncomplete(startTime);
    await startTime.trigger('blur');

    expectFieldLevelError(startTime);
  });

  it('clears the field-level error once the time becomes valid', async () => {
    wrapper = await mountEditor();

    const startTime = wrapper.find('.schedule-list input[type="time"]');
    forceIncomplete(startTime);
    await startTime.trigger('blur');
    expect(startTime.attributes('aria-invalid')).toBe('true');

    Object.defineProperty(startTime.element, 'validity', {
      configurable: true,
      value: { badInput: false, valid: true },
    });
    await startTime.setValue('14:30');

    expect(startTime.attributes('aria-invalid')).toBeUndefined();
    expect(startTime.attributes('aria-describedby')).toBeUndefined();
    expect(startTime.classes()).not.toContain('field-input--error');
  });
});
