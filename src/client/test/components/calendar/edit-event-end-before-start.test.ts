import { expect, describe, it, afterEach, beforeEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, RouteRecordRaw } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';

import { Calendar } from '@/common/model/calendar';
import { mountComponent } from '@/client/test/lib/vue';
import EditEvent from '@/client/components/logged_in/calendar/edit_event.vue';
import CalendarService from '@/client/service/calendar';
import EventService from '@/client/service/event';

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

describe('End before start', () => {
  let wrapper: any = null;
  let saveStub: sinon.SinonStub;

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

  const fillSchedule = async (endDateOffsetDays = 0) => {
    await wrapper.find('#event-name-en').setValue('Titled event');
    const [startDate, endDate] = wrapper.findAll('.schedule-list input[type="date"]');
    const [startTime, endTime] = wrapper.findAll('.schedule-list input[type="time"]');
    await startDate.setValue('2030-06-01');
    await startTime.setValue('10:00');
    await endDate.setValue(endDateOffsetDays === 0 ? '2030-06-01' : '2030-06-02');
    await endTime.setValue('09:00');
    return { endDate, endTime };
  };

  it('refuses to save, marks the end time and focuses it', async () => {
    saveStub = sinon.stub(EventService.prototype, 'saveEvent').resolves({} as any);
    wrapper = await mountEditor();
    const { endTime } = await fillSchedule();

    await wrapper.find('form').trigger('submit');
    await flushPromises();
    await nextTick();

    expect(saveStub.called).toBe(false);
    expect(endTime.attributes('aria-invalid')).toBe('true');
    expect(endTime.classes()).toContain('field-input--error');
    const message = document.getElementById(endTime.attributes('aria-describedby') as string);
    expect(message?.textContent).toContain('end date to the next day');
    expect(document.activeElement).toBe(endTime.element);
  });

  it('clears the error when the end date moves to the next day, and saves', async () => {
    saveStub = sinon.stub(EventService.prototype, 'saveEvent').resolves({} as any);
    wrapper = await mountEditor();
    const { endDate, endTime } = await fillSchedule();
    expect(endTime.attributes('aria-invalid')).toBe('true');

    await endDate.setValue('2030-06-02');

    expect(endTime.attributes('aria-invalid')).toBeUndefined();
    expect(endTime.attributes('aria-describedby')).toBeUndefined();

    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(saveStub.called).toBe(true);
  });
});
