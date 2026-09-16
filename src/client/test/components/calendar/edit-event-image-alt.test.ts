import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createRouter, createWebHistory, Router } from 'vue-router';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { nextTick } from 'vue';
import EditEventView from '@/client/components/logged_in/calendar/edit_event.vue';
import { CalendarEvent } from '@/common/model/events';
import { Calendar } from '@/common/model/calendar';
import { mountComponent } from '@/client/test/lib/vue';

/**
 * The alt-text editor inside the event editor's image panel.
 *
 * Two things are under test here and neither lives in ImageAltEditor itself:
 * that the editor appears with the image and not before it, and that alt text
 * written for every language survives the editor's ordinary save path. The
 * second matters because `imageAlt` is replace-on-update server-side — a save
 * payload that omits a language's alt text clears it — so the regression this
 * guards against is a save that carries only the language the author happened
 * to be looking at.
 */

const EVENT_ID = '123e4567-e89b-12d3-a456-426614174000';

const createMockCalendar = (id: string, urlName: string) => {
  const calendar = new Calendar(id, urlName);
  calendar.addContent({
    language: 'en',
    name: `Test Calendar ${urlName}`,
    description: 'Test Description',
  });
  return calendar;
};

/**
 * Builds the serialized event the editor loads in edit mode.
 *
 * @param {Record<string, any>} overrides - Fields to merge over the defaults
 * @returns {Record<string, any>} A serialized event payload
 */
const serializedEvent = (overrides: Record<string, any> = {}): Record<string, any> => ({
  id: EVENT_ID,
  calendarId: 'calendar-123',
  schedules: [{ id: 'schedule-1', start: '2026-07-01T18:00:00Z' }],
  content: {
    en: { name: 'Test Event', description: 'Test' },
    fr: { name: 'Événement test', description: 'Essai' },
  },
  location: null,
  categories: [],
  ...overrides,
});

// Captures the model handed to the save path so the test can inspect the
// payload that would go on the wire.
const savedEvents: CalendarEvent[] = [];

vi.mock('@/client/service/calendar', () => ({
  default: vi.fn().mockImplementation(() => ({
    loadCalendars: vi.fn().mockResolvedValue([
      createMockCalendar('calendar-123', 'test-calendar'),
    ]),
    getCalendarByUrlName: vi.fn(),
  })),
}));

vi.mock('@/client/service/event', () => ({
  default: vi.fn().mockImplementation(() => ({
    initEvent: vi.fn(),
    saveEvent: vi.fn((event: CalendarEvent) => {
      savedEvents.push(event);
      return Promise.resolve(event);
    }),
  })),
}));

vi.mock('@/client/service/category', () => ({
  default: vi.fn().mockImplementation(() => ({
    getEventCategories: vi.fn().mockResolvedValue([]),
    assignCategoriesToEvent: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/client/service/location', () => ({
  default: vi.fn().mockImplementation(() => ({
    getLocations: vi.fn().mockResolvedValue([]),
    createLocation: vi.fn().mockResolvedValue({}),
  })),
}));

const mockGetModel = vi.fn().mockResolvedValue(null);
vi.mock('@/client/service/models', () => ({
  default: {
    getModel: (...args: any[]) => mockGetModel(...args),
  },
}));

vi.mock('i18next-vue', () => ({
  default: {
    install: () => {},
  },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

vi.mock('i18next', () => ({
  default: {},
}));

vi.mock('@/client/service/locale', () => ({
  initI18Next: () => {},
}));

vi.mock('iso-639-1-dir', () => ({
  default: {
    getName: (code: string) => (code === 'en' ? 'English' : code === 'fr' ? 'French' : code),
    getDir: () => 'ltr',
    getAllCodes: () => ['en', 'es', 'fr'],
  },
}));

vi.mock('@/client/composables/useEventDuplication', () => ({
  useEventDuplication: () => ({
    stripEventForDuplication: vi.fn((event: CalendarEvent) => event.clone()),
  }),
}));

vi.mock('@/client/stores/calendarStore', () => ({
  useCalendarStore: () => ({
    selectedCalendar: null,
    setSelectedCalendar: vi.fn(),
    calendars: [],
    addCalendar: vi.fn(),
  }),
}));

describe('EditEventView - image alt text', () => {
  let router: Router;
  let pinia: Pinia;

  const mountEditor = async (eventPayload: Record<string, any>) => {
    mockGetModel.mockResolvedValueOnce(eventPayload);

    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/event', name: 'event_new', component: EditEventView },
        { path: '/event/:eventId', name: 'event_edit', component: EditEventView, props: true },
        { path: '/calendar', name: 'calendars', component: { template: '<div>Calendars</div>' } },
        { path: '/calendar/:calendar', name: 'calendar', component: { template: '<div>Calendar</div>' } },
        { path: '/auth/login', name: 'login', component: { template: '<div>Login</div>' } },
      ],
    });
    await router.push(`/event/${EVENT_ID}`);
    await router.isReady();

    const wrapper = mountComponent(EditEventView, router, {
      pinia,
      props: { eventId: EVENT_ID },
      stubs: {
        EventRecurrenceView: true,
        languagePicker: true,
        ImageUpload: true,
        ImageWorkspace: true,
        CategorySelector: true,
        SeriesSelector: true,
      },
    });

    await flushPromises();
    await nextTick();
    await nextTick();

    return wrapper;
  };

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    savedEvents.length = 0;
    mockGetModel.mockReset();
    mockGetModel.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not render the alt editor when the event has no image', async () => {
    const wrapper = await mountEditor(serializedEvent());

    expect(wrapper.find('.image-alt-editor').exists()).toBe(false);
  });

  it('renders the alt editor once the event has an image', async () => {
    const wrapper = await mountEditor(serializedEvent({ mediaId: 'media-1' }));

    expect(wrapper.find('.image-alt-editor').exists()).toBe(true);
  });

  it('writes the description to the language the editor is showing, with no language control of its own', async () => {
    const wrapper = await mountEditor(serializedEvent({
      mediaId: 'media-1',
      content: {
        en: { name: 'Test Event', imageAlt: 'A crowd under string lights' },
        fr: { name: 'Événement test', imageAlt: 'Une foule sous des guirlandes' },
      },
    }));

    const altEditor = wrapper.find('.image-alt-editor');
    expect(altEditor.find('select').exists()).toBe(false);

    const textarea = altEditor.find('textarea');
    await textarea.setValue('A crowd dancing under string lights');

    expect((wrapper.vm as any).editorState.event.content('en').imageAlt)
      .toBe('A crowd dancing under string lights');
    // The language the editor is not showing is left exactly as it was.
    expect((wrapper.vm as any).editorState.event.content('fr').imageAlt)
      .toBe('Une foule sous des guirlandes');
  });

  it('sends alt text for every language when the author saves an unrelated field', async () => {
    const wrapper = await mountEditor(serializedEvent({
      mediaId: 'media-1',
      content: {
        en: { name: 'Test Event', imageAlt: 'A crowd under string lights' },
        fr: { name: 'Événement test', imageAlt: 'Une foule sous des guirlandes' },
      },
    }));

    // Edit only the title, in only one language — the "save just the title"
    // case that a partial payload would turn into silent alt-text deletion.
    await wrapper.find('#event-name-en').setValue('Renamed Event');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(savedEvents).toHaveLength(1);
    const payload = savedEvents[0].toObject();
    expect(payload.content.en.imageAlt).toBe('A crowd under string lights');
    expect(payload.content.fr.imageAlt).toBe('Une foule sous des guirlandes');
  });

  it('sends an empty alt text for every language after the author chooses Decorative', async () => {
    const wrapper = await mountEditor(serializedEvent({
      mediaId: 'media-1',
      content: {
        en: { name: 'Test Event', imageAlt: 'A crowd under string lights' },
        fr: { name: 'Événement test', imageAlt: 'Une foule sous des guirlandes' },
      },
    }));

    const radios = wrapper.find('.image-alt-editor').findAll('input[type="radio"]');
    await radios[0].trigger('change');

    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(savedEvents).toHaveLength(1);
    const payload = savedEvents[0].toObject();
    // Present-and-empty, not absent: the server replaces imageAlt on update, so
    // an empty string is what makes Decorative persist.
    expect(payload.content.en.imageAlt).toBe('');
    expect(payload.content.fr.imageAlt).toBe('');
  });
});
