import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import CalendarSettings from '@/client/components/logged_in/calendar-management/settings.vue';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import Config from '@/client/service/config';
import { Calendar, CalendarContent } from '@/common/model/calendar';

/**
 * The calendar's default date window.
 *
 * A calendar with no window of its own falls back to the instance default on
 * the public site, so the settings screen must not write one the owner never
 * chose: saving the name or description leaves the window unset, and the
 * window is sent only once the owner picks one.
 */

const SETTINGS_TRANSLATIONS = {
  'settings.default_date_range_label': 'Default Date Filter',
  'settings.default_date_range_instance': 'Instance default',
  'settings.date_range_1week': '1 week',
  'settings.date_range_2weeks': '2 weeks',
  'settings.date_range_1month': '1 month',
};

function createCalendar(defaultDateRange?: '1month'): Calendar {
  const calendar = new Calendar('calendar-123', 'test-calendar');
  calendar.addContent(new CalendarContent('en', 'My Calendar', 'A calendar'));
  if (defaultDateRange) {
    calendar.defaultDateRange = defaultDateRange;
  }
  return calendar;
}

const mountSettings = () => {
  return mount(CalendarSettings, {
    global: {
      plugins: [
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
});

describe('CalendarSettings — default date window', () => {
  it('names the select with its card heading', async () => {
    stubScreenLoads(createCalendar());

    const wrapper = mountSettings();
    await flushPromises();

    const labelId = wrapper.find('#defaultDateRange').attributes('aria-labelledby');
    expect(labelId).toBeTruthy();
    const label = wrapper.find(`#${labelId}`);
    expect(label.element.tagName).toBe('H2');
    expect(label.text()).not.toBe('');

    wrapper.unmount();
  });

  it('shows "Instance default" selected when the calendar has no window', async () => {
    stubScreenLoads(createCalendar());

    const wrapper = mountSettings();
    await flushPromises();

    const select = wrapper.find('#defaultDateRange').element as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent?.trim()).toBe('Instance default');

    wrapper.unmount();
  });

  it('sends no window when the name and description are saved on a calendar without one', async () => {
    const update = stubScreenLoads(createCalendar());

    const wrapper = mountSettings();
    await flushPromises();

    await wrapper.find('#calendarTitle-en').trigger('blur');
    await flushPromises();
    await wrapper.find('#calendarDescription-en').trigger('blur');
    await flushPromises();

    expect(update).toHaveBeenCalledTimes(2);
    for (const [, settings] of update.mock.calls) {
      expect(settings).not.toHaveProperty('defaultDateRange');
    }

    wrapper.unmount();
  });

  it('sends the window the owner picks, and stops offering "Instance default"', async () => {
    const update = stubScreenLoads(createCalendar());

    const wrapper = mountSettings();
    await flushPromises();

    await wrapper.find('#defaultDateRange').setValue('1month');
    await flushPromises();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toMatchObject({ defaultDateRange: '1month' });
    expect(wrapper.find('#defaultDateRange').text()).not.toContain('Instance default');

    wrapper.unmount();
  });

  it('does not offer "Instance default" once the calendar has a window', async () => {
    stubScreenLoads(createCalendar('1month'));

    const wrapper = mountSettings();
    await flushPromises();

    const select = wrapper.find('#defaultDateRange');
    expect(select.text()).not.toContain('Instance default');
    expect((select.element as HTMLSelectElement).value).toBe('1month');

    wrapper.unmount();
  });
});
