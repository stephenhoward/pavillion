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
import { Media } from '@/common/model/media';

/**
 * Alt text for the calendar's default event image.
 *
 * The image itself is stored the moment it is uploaded, but its description is
 * translated content: it lives on the calendar's content rows and travels with
 * the ordinary content save. The three things that can go wrong at this seam —
 * offering a description with no image to describe, leaving a description
 * behind when the image goes, and dropping `imageAlt` from a payload the server
 * treats as a replacement — are what is pinned here.
 */

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
  'settings.default_event_image_remove_button': 'Remove image',
  'settings.remove_language': 'Remove {{language}} translation',
};

// The alt editor reads its own namespace; supplying it keeps the assertions
// below matching rendered text rather than raw key names.
const MEDIA_TRANSLATIONS = {
  'alt_editor.legend': 'Screen readers',
  'alt_editor.decorative_label': 'Decorative',
  'alt_editor.decorative_help': 'The image is hidden from screen readers.',
  'alt_editor.describe_label': 'Describe this image',
  'alt_editor.describe_help': 'Screen readers read your description.',
  'alt_editor.description_label': 'Image description ({{language}})',
  'alt_editor.description_hint': 'Write what the image shows.',
  'alt_editor.stash_note': 'The descriptions you wrote will be removed when you save.',
};

/**
 * Builds a bilingual calendar, optionally carrying a default event image and
 * alt text for it in both languages.
 *
 * @param {object} options - What the calendar should carry
 * @param {boolean} options.withImage - Whether a default event image is set
 * @param {string} options.altEn - English alt text for that image
 * @param {string} options.altEs - Spanish alt text for that image
 * @returns {Calendar} The calendar the settings screen will load
 */
function createCalendar({ withImage = true, altEn = '', altEs = '' } = {}): Calendar {
  const calendar = new Calendar('calendar-123', 'test-calendar');
  calendar.addContent(new CalendarContent('en', 'My Calendar', 'A calendar', altEn));
  calendar.addContent(new CalendarContent('es', 'Mi Calendario', 'Un calendario', altEs));

  if (withImage) {
    calendar.defaultEventImageId = 'media-1';
    calendar.defaultEventImage = new Media(
      'media-1', 'calendar-123', 'abc123', 'poster.jpg', 'image/jpeg', 1024, 'approved',
    );
  }

  return calendar;
}

/**
 * Mounts the settings screen with the child components that make requests
 * stubbed out. ImageAltEditor is deliberately left unstubbed: it is the
 * component under test at this seam.
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

/**
 * Answers the reads the settings screen makes on mount, so that nothing here
 * touches the network. Left unmocked, the funding read fails and its section
 * disappears for the wrong reason.
 *
 * @param {Calendar} calendar - The calendar the screen should load
 */
function stubScreenLoads(calendar: Calendar): void {
  vi.spyOn(CalendarService.prototype, 'getCalendarById').mockResolvedValue(calendar);
  vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
    status: 'not_covered',
    features: { widget_embedding: false },
  } as never);
  vi.spyOn(Config, 'init').mockResolvedValue({
    settings: () => ({ siteTitle: 'Test Instance' }),
  } as never);
}

// i18next is a module singleton, so both suites below share one initialisation.
beforeAll(async () => {
  await i18next.init({
    lng: 'en',
    resources: {
      en: {
        calendars: SETTINGS_TRANSLATIONS,
        media: MEDIA_TRANSLATIONS,
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CalendarSettings — default image alt text', () => {
  it('offers no alt editor while the calendar has no default image', async () => {
    stubScreenLoads(createCalendar({ withImage: false }));

    const wrapper = mountSettings();
    await flushPromises();

    expect(wrapper.find('.image-alt-editor').exists()).toBe(false);

    wrapper.unmount();
  });

  it('offers the alt editor for the current language once a default image is set', async () => {
    stubScreenLoads(createCalendar({ altEn: 'A crowded street fair' }));

    const wrapper = mountSettings();
    await flushPromises();

    const editor = wrapper.find('.image-alt-editor');
    expect(editor.exists()).toBe(true);

    // Seeded from the stored alt text, and labelled with the language the
    // content card's tabs are showing — the editor carries no selector of its
    // own, so that label is what disambiguates it this far from the tabs.
    const textarea = editor.find('textarea');
    expect(textarea.exists()).toBe(true);
    expect((textarea.element as HTMLTextAreaElement).value).toBe('A crowded street fair');
    expect(editor.text()).toContain('Image description (English)');

    wrapper.unmount();
  });

  it('clears the alt text in every language when the default image is removed', async () => {
    stubScreenLoads(createCalendar({ altEn: 'A crowded street fair', altEs: 'Una feria concurrida' }));
    vi.spyOn(CalendarService.prototype, 'updateCalendarSettings')
      .mockResolvedValue(createCalendar({ withImage: false }));

    // The screen edits a clone of the loaded calendar; capture it to assert
    // against the working model the next save will send.
    const cloneSpy = vi.spyOn(Calendar.prototype, 'clone');

    const wrapper = mountSettings();
    await flushPromises();

    await wrapper.find('.remove-image-btn').trigger('click');
    await flushPromises();

    const workingCopy = cloneSpy.mock.results[0].value as Calendar;
    expect(workingCopy.getLanguages()).toEqual(['en', 'es']);
    for (const language of workingCopy.getLanguages()) {
      expect(workingCopy.content(language).imageAlt).toBe('');
    }

    // The description goes, the rest of the content stays.
    expect(workingCopy.content('en').name).toBe('My Calendar');
    expect(workingCopy.content('es').description).toBe('Un calendario');

    // And the editor goes with the image it described.
    expect(wrapper.find('.image-alt-editor').exists()).toBe(false);

    wrapper.unmount();
  });

  it('sends imageAlt for every language on a content save', async () => {
    stubScreenLoads(createCalendar({ altEn: 'A crowded street fair' }));
    const updateSpy = vi.spyOn(CalendarService.prototype, 'updateCalendarSettings')
      .mockResolvedValue(createCalendar({ altEn: 'A crowded street fair' }));

    const wrapper = mountSettings();
    await flushPromises();

    await wrapper.find('#calendarTitle-en').trigger('blur');
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith('calendar-123', expect.objectContaining({
      content: {
        // The Spanish row has no alt text and is sent all the same: the server
        // replaces imageAlt rather than patching it, so an omitted language
        // would silently clear whatever is stored for it.
        en: { name: 'My Calendar', description: 'A calendar', imageAlt: 'A crowded street fair' },
        es: { name: 'Mi Calendario', description: 'Un calendario', imageAlt: '' },
      },
    }));

    wrapper.unmount();
  });

  it('persists the cleared alt text in the same request that removes the image', async () => {
    stubScreenLoads(createCalendar({ altEn: 'A crowded street fair', altEs: 'Una feria concurrida' }));
    const updateSpy = vi.spyOn(CalendarService.prototype, 'updateCalendarSettings')
      .mockResolvedValue(createCalendar({ withImage: false }));

    const wrapper = mountSettings();
    await flushPromises();

    await wrapper.find('.remove-image-btn').trigger('click');
    await flushPromises();

    // Removing the image unmounts the editor, so this request is the last
    // chance the cleared description has to reach the server.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith('calendar-123', {
      defaultEventImageId: null,
      content: {
        en: { name: 'My Calendar', description: 'A calendar', imageAlt: '' },
        es: { name: 'Mi Calendario', description: 'Un calendario', imageAlt: '' },
      },
    });

    wrapper.unmount();
  });
});

/**
 * The screen has no Save button, so the alt editor persists on focus leaving
 * it. What makes that safe is the `relatedTarget` check: the editor holds two
 * radios and a textarea, and saving between them would disable the control the
 * author is moving to.
 */
describe('CalendarSettings — saving the default image alt text', () => {
  /**
   * Dispatches a real bubbling focusout. `trigger()` cannot stand in for it:
   * the whole decision the screen makes here reads `relatedTarget`, which only
   * a constructed FocusEvent carries.
   *
   * @param {Element} from - The control focus is leaving
   * @param {EventTarget | null} relatedTarget - What receives focus, or null
   *   when focus leaves the document entirely
   */
  function focusOut(from: Element, relatedTarget: EventTarget | null): void {
    from.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget }));
  }

  it('does not save while focus moves between the editor\'s own controls', async () => {
    stubScreenLoads(createCalendar({ altEn: 'A crowded street fair' }));
    const updateSpy = vi.spyOn(CalendarService.prototype, 'updateCalendarSettings')
      .mockResolvedValue(createCalendar({ altEn: 'A crowded street fair' }));

    const wrapper = mountSettings();
    await flushPromises();

    const editor = wrapper.find('.image-alt-editor');
    const radio = editor.findAll('input[type="radio"]')[1].element;
    const textarea = editor.find('textarea').element;

    focusOut(radio, textarea);
    await flushPromises();

    // A save here would set isSaving, which disables the editor — taking the
    // author's focus away mid-interaction.
    expect(updateSpy).not.toHaveBeenCalled();
    expect(textarea.disabled).toBe(false);

    wrapper.unmount();
  });

  it('saves the alt text when focus leaves the editor', async () => {
    stubScreenLoads(createCalendar({ altEn: 'A crowded street fair' }));
    const updateSpy = vi.spyOn(CalendarService.prototype, 'updateCalendarSettings')
      .mockResolvedValue(createCalendar({ altEn: 'A market at dusk' }));

    const wrapper = mountSettings();
    await flushPromises();

    const textarea = wrapper.find('.image-alt-editor textarea');
    await textarea.setValue('A market at dusk');

    focusOut(textarea.element, wrapper.find('#calendarTitle-en').element);
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith('calendar-123', expect.objectContaining({
      content: {
        en: { name: 'My Calendar', description: 'A calendar', imageAlt: 'A market at dusk' },
        es: { name: 'Mi Calendario', description: 'Un calendario', imageAlt: '' },
      },
    }));

    wrapper.unmount();
  });

  it('saves when focus leaves the document entirely', async () => {
    stubScreenLoads(createCalendar({ altEn: 'A crowded street fair' }));
    const updateSpy = vi.spyOn(CalendarService.prototype, 'updateCalendarSettings')
      .mockResolvedValue(createCalendar({ altEn: 'A crowded street fair' }));

    const wrapper = mountSettings();
    await flushPromises();

    const textarea = wrapper.find('.image-alt-editor textarea');
    await textarea.setValue('A market at dusk');

    // Tabbing to browser chrome, or clicking dead space: nothing receives
    // focus, and the author is still done with the editor.
    focusOut(textarea.element, null);
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith('calendar-123', expect.objectContaining({
      content: expect.objectContaining({
        en: { name: 'My Calendar', description: 'A calendar', imageAlt: 'A market at dusk' },
      }),
    }));

    wrapper.unmount();
  });

  it('leaves the control focus is moving to enabled while the save runs', async () => {
    stubScreenLoads(createCalendar({ altEn: 'A crowded street fair' }));

    // Held open so the assertions land mid-save, which is the only moment the
    // defect exists: the flag is set and cleared inside one focusout.
    let finishSave: (calendar: Calendar) => void = () => {};
    vi.spyOn(CalendarService.prototype, 'updateCalendarSettings')
      .mockImplementation(() => new Promise((resolve) => {
        finishSave = resolve as (calendar: Calendar) => void;
      }));

    const wrapper = mountSettings();
    await flushPromises();

    // "Remove default image" is what a Shift+Tab out of the editor reaches.
    const removeButton = wrapper.find('.remove-image-btn');
    const textarea = wrapper.find('.image-alt-editor textarea');

    focusOut(textarea.element, removeButton.element);
    await flushPromises();

    // The editor itself is disabled, so the save is genuinely in flight...
    expect((textarea.element as HTMLTextAreaElement).disabled).toBe(true);

    // ...and the button focus is moving to is not. Disabling it here would
    // leave it both disabled and unfocused, and the browser falls back to
    // <body>: the author loses their place and tabs from the top again.
    expect((removeButton.element as HTMLButtonElement).disabled).toBe(false);

    finishSave(createCalendar({ altEn: 'A crowded street fair' }));
    await flushPromises();

    expect((textarea.element as HTMLTextAreaElement).disabled).toBe(false);

    wrapper.unmount();
  });

  it('saves the Decorative choice once focus leaves the editor', async () => {
    stubScreenLoads(createCalendar({ altEn: 'A crowded street fair', altEs: 'Una feria concurrida' }));
    const updateSpy = vi.spyOn(CalendarService.prototype, 'updateCalendarSettings')
      .mockResolvedValue(createCalendar({ withImage: true }));

    const wrapper = mountSettings();
    await flushPromises();

    const editor = wrapper.find('.image-alt-editor');
    const decorative = editor.findAll('input[type="radio"]')[0];
    await decorative.trigger('change');

    focusOut(decorative.element, wrapper.find('#calendarTitle-en').element);
    await flushPromises();

    // Decorative is the absence of alt text in every language, not a flag, so
    // what has to reach the server is the cleared value for each of them.
    expect(updateSpy).toHaveBeenCalledWith('calendar-123', expect.objectContaining({
      content: {
        en: { name: 'My Calendar', description: 'A calendar', imageAlt: '' },
        es: { name: 'Mi Calendario', description: 'Un calendario', imageAlt: '' },
      },
    }));

    wrapper.unmount();
  });
});
