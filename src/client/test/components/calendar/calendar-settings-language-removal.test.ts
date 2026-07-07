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

// Minimal translations required by the settings component
const SETTINGS_TRANSLATIONS = {
  'settings.title': 'Calendar Settings',
  'settings.loading': 'Loading settings...',
  'settings.calendar_content_section': 'Calendar Title & Description',
  'settings.calendar_title_help': 'The display name for your calendar.',
  'settings.calendar_title_label': 'Calendar Title',
  'settings.calendar_title_placeholder': 'My Community Calendar',
  'settings.calendar_description_label': 'Calendar Description',
  'settings.calendar_description_help': 'A brief description of your calendar.',
  'settings.calendar_description_placeholder': 'A calendar of community events...',
  'settings.default_date_range_label': 'Default Date Filter',
  'settings.default_date_range_help': 'Default date filter help.',
  'settings.date_range_1week': '1 week',
  'settings.date_range_2weeks': '2 weeks',
  'settings.date_range_1month': '1 month',
  'settings.default_event_image_label': 'Default Event Image',
  'settings.default_event_image_help': 'Default image help.',
  'settings.remove_language': 'Remove {{language}} translation',
};

/**
 * Create a test Calendar with two languages (English + Spanish)
 */
function createBilingualCalendar(): Calendar {
  const calendar = new Calendar('calendar-123', 'test-calendar');
  calendar.addContent(new CalendarContent('en', 'My Calendar', 'A calendar'));
  calendar.addContent(new CalendarContent('es', 'Mi Calendario', 'Un calendario'));
  return calendar;
}

/**
 * Mount CalendarSettings with stubs to bypass child-component and modal
 * concerns that are not under test here.
 */
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
        // Stub the tab selector — the remove path under test is the inline
        // remove-translation-link button on the settings component itself.
        // Expose panelId/tabId because the parent template calls them on the
        // component ref to wire up tabpanel aria attributes.
        LanguageTabSelector: {
          template: '<div />',
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

describe('CalendarSettings — language removal wiring', () => {
  beforeAll(async () => {
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          calendars: SETTINGS_TRANSLATIONS,
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops the removed language from the calendar when the remove-translation link is clicked', async () => {
    const calendar = createBilingualCalendar();

    vi.spyOn(CalendarService.prototype, 'getCalendarById').mockResolvedValue(calendar);
    // Funding disabled so the extended-features card (and its async status
    // load) stays out of this test.
    vi.spyOn(FundingService.prototype, 'getOptions').mockResolvedValue({
      enabled: false,
      providers: [],
    } as never);
    vi.spyOn(Config, 'init').mockResolvedValue({
      settings: () => ({ siteTitle: 'Test Instance' }),
    } as never);

    // The component edits a clone of the loaded calendar; capture it so we
    // can assert the onLanguageRemoved hook dropped the content from the
    // working copy via entity.dropContent.
    const cloneSpy = vi.spyOn(Calendar.prototype, 'clone');
    const dropContentSpy = vi.spyOn(Calendar.prototype, 'dropContent');

    const wrapper = mountSettings();
    await flushPromises();

    const removeLink = wrapper.find('.remove-translation-link');
    expect(removeLink.exists()).toBe(true);
    await removeLink.trigger('click');
    await flushPromises();

    // currentLanguage is seeded to the calendar's first language ('en'); the
    // link removes that language and the hook drops it from the clone.
    expect(dropContentSpy).toHaveBeenCalledWith('en');

    const workingCopy = cloneSpy.mock.results[0].value as Calendar;
    expect(workingCopy.getLanguages()).toEqual(['es']);
    expect(workingCopy.getLanguages()).not.toContain('en');

    wrapper.unmount();
  });
});
