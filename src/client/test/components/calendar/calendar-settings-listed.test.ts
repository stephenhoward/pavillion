import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import CalendarSettings from '@/client/components/logged_in/calendar-management/settings.vue';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import Config from '@/client/service/config';
import { Calendar, CalendarContent } from '@/common/model/calendar';

/**
 * Whether the calendar appears on the instance's public calendar list.
 *
 * The control reflects the stored value, saves the new value on its own when
 * changed, and goes back to the stored value when the save fails, so the
 * screen never claims the calendar is off the list while it is still on it.
 */

const SETTINGS_TRANSLATIONS = {
  'settings.listed_label': "Show on this instance's calendar list",
  'settings.listed_help': 'It is still public.',
};

function createCalendar(listed: boolean): Calendar {
  const calendar = new Calendar('calendar-123', 'test-calendar');
  calendar.addContent(new CalendarContent('en', 'My Calendar', 'A calendar'));
  calendar.listed = listed;
  return calendar;
}

const mountSettings = () => {
  return mount(CalendarSettings, {
    attachTo: document.body,
    global: {
      plugins: [
        // The screen is a routed leaf: it reads the route on mount.
        createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: {} }] }),
        [I18NextVue, { i18next }],
        createPinia(),
      ],
      stubs: {
        LoadingMessage: { template: '<div />' },
        ImageUpload: { template: '<div />' },
        EventImage: { template: '<div />' },
        LanguagePicker: { template: '<div />' },
        FundingSheet: { template: '<div />' },
        LanguageTabSelector: {
          template: '<div><slot /></div>',
          methods: {
            panelId: (lang: string) => `panel-${lang}`,
            tabId: (lang: string) => `tab-${lang}`,
          },
        },
      },
    },
    props: { calendarId: 'calendar-123' },
  });
};

function stubScreenLoads(calendar: Calendar) {
  vi.spyOn(CalendarService.prototype, 'getCalendarById').mockResolvedValue(calendar);
  vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
    status: 'not_covered',
    features: { widget_embedding: false },
  } as never);
  vi.spyOn(Config, 'init').mockResolvedValue({
    settings: () => ({ siteTitle: 'Test Instance' }),
  } as never);
  return vi.spyOn(CalendarService.prototype, 'updateCalendarSettings').mockResolvedValue(calendar);
}

beforeAll(async () => {
  await i18next.init({
    lng: 'en',
    resources: { en: { calendars: SETTINGS_TRANSLATIONS } },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('CalendarSettings — listed on the calendar list', () => {
  it('is a checkbox named by its label and described by the help text', async () => {
    stubScreenLoads(createCalendar(true));

    const wrapper = mountSettings();
    await flushPromises();

    const checkbox = wrapper.find('#listed');
    expect(checkbox.attributes('type')).toBe('checkbox');

    const label = wrapper.find('label[for="listed"]');
    expect(label.text()).toBe("Show on this instance's calendar list");

    const helpId = checkbox.attributes('aria-describedby');
    expect(wrapper.find(`#${helpId}`).text()).toBe('It is still public.');

    wrapper.unmount();
  });

  it.each([true, false])('reflects a stored value of %s', async (listed) => {
    stubScreenLoads(createCalendar(listed));

    const wrapper = mountSettings();
    await flushPromises();

    expect((wrapper.find('#listed').element as HTMLInputElement).checked).toBe(listed);

    wrapper.unmount();
  });

  it('saves only the listed flag when the owner unchecks it', async () => {
    const update = stubScreenLoads(createCalendar(true));

    const wrapper = mountSettings();
    await flushPromises();

    await wrapper.find('#listed').setValue(false);
    await flushPromises();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]).toEqual(['calendar-123', { listed: false }]);
    expect((wrapper.find('#listed').element as HTMLInputElement).checked).toBe(false);

    wrapper.unmount();
  });

  it('toggles when its label is activated', async () => {
    const update = stubScreenLoads(createCalendar(false));

    const wrapper = mountSettings();
    await flushPromises();

    // A click on the label is what a tap on the heading text does.
    await wrapper.find('label[for="listed"]').trigger('click');
    await flushPromises();

    expect(update).toHaveBeenCalledWith('calendar-123', { listed: true });

    wrapper.unmount();
  });

  it('puts the checkbox back and shows an error when the save fails', async () => {
    const update = stubScreenLoads(createCalendar(true));
    update.mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const wrapper = mountSettings();
    await flushPromises();

    await wrapper.find('#listed').setValue(false);
    await flushPromises();

    expect((wrapper.find('#listed').element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find('.alert--error').exists()).toBe(true);

    wrapper.unmount();
  });
});
