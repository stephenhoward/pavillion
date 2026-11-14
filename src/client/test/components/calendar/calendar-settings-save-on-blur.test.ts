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
import { Media } from '@/common/model/media';

/**
 * A save triggered by blur must not disable the control the user is clicking.
 *
 * Mousedown blurs the focused field, the blur starts a save, and a control
 * disabled by that save never receives the click that began the sequence.
 */

function createCalendar(): Calendar {
  const calendar = new Calendar('calendar-123', 'test-calendar');
  calendar.addContent(new CalendarContent('en', 'My Calendar', 'A calendar'));
  calendar.defaultEventImageId = 'media-1';
  calendar.defaultEventImage = new Media(
    'media-1', 'calendar-123', 'abc123', 'poster.jpg', 'image/jpeg', 1024, 'approved',
  );
  return calendar;
}

const mountSettings = () => mount(CalendarSettings, {
  global: {
    plugins: [
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

beforeAll(async () => {
  await i18next.init({ lng: 'en', resources: { en: {} } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CalendarSettings — save on blur', () => {
  it('keeps controls enabled while a blur-triggered save is in flight', async () => {
    vi.spyOn(CalendarService.prototype, 'getCalendarById').mockResolvedValue(createCalendar());
    vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
      status: 'not_covered',
      features: { widget_embedding: false },
    } as never);
    vi.spyOn(Config, 'init').mockResolvedValue({
      settings: () => ({ siteTitle: 'Test Instance' }),
    } as never);

    // A save that stays pending for the whole assertion window.
    let finishSave: (c: Calendar) => void = () => {};
    vi.spyOn(CalendarService.prototype, 'updateCalendarSettings')
      .mockReturnValue(new Promise<Calendar>((resolve) => { finishSave = resolve; }));

    const wrapper = mountSettings();
    await flushPromises();

    await wrapper.find('input.setting-input').trigger('blur');
    await flushPromises();

    const selectors = ['input.setting-input', 'textarea.setting-textarea', 'select.setting-select', '.remove-image-btn'];
    for (const selector of selectors) {
      expect(wrapper.find(selector).attributes('disabled'), selector).toBeUndefined();
    }

    finishSave(createCalendar());
    await flushPromises();
    wrapper.unmount();
  });
});
