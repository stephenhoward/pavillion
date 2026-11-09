/**
 * Tests for the dated event page's fallback when its occurrence no longer
 * exists, typically because the owner changed the event's time after the
 * link was shared.
 *
 * Validates:
 * - A found occurrence renders with no fallback and no redirect.
 * - A link the event's current occurrence replaces (its only date, or its
 *   only occurrence that day) lands on that occurrence's dated address.
 * - Any other missing date lands on the undated page, carrying the linked
 *   start in router state for the note.
 * - The fallback never replaces to the slug it was asked for.
 * - An event the link's calendar does not show stays Not Found.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { DateTime } from 'luxon';

vi.mock('@/common/ui/composables/useLocale', async () => {
  const { ref } = await import('vue');
  const currentLocale = ref('en');
  return {
    useLocale: () => ({
      currentLocale,
      switchLocale: vi.fn(),
      localizedPath: (path: string) => path,
    }),
  };
});

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const LINKED_SLUG = '20261115-0000';
const LINKED_PATH = `/test_calendar/events/${EVENT_ID}/${LINKED_SLUG}`;

function fakeEvent() {
  return {
    id: EVENT_ID,
    content: (_lang: string) => ({ name: 'Harvest Supper', description: '' }),
    hasContent: (_lang: string) => true,
    getLanguages: () => ['en'],
    series: null,
  };
}

function fakeInstance(startIso: string) {
  return { start: DateTime.fromISO(startIso, { zone: 'utc' }), end: null, event: fakeEvent() };
}

const service = {
  getCalendarByUrlName: vi.fn(),
  loadEventInstance: vi.fn(),
  loadEventForMissingOccurrence: vi.fn(),
};

vi.mock('@/site/service/calendar', () => ({
  default: vi.fn().mockImplementation(function () {
    return service;
  }),
}));

vi.mock('@/site/components/EventDetailBody.vue', () => ({
  default: { template: '<div class="detail-body-stub"></div>', props: ['instance', 'categoryHrefBuilder'] },
}));
vi.mock('@/site/components/report-event.vue', () => ({
  default: { template: '<div></div>', props: ['eventId'] },
}));
vi.mock('@/site/components/not-found.vue', () => ({
  default: { template: '<div class="not-found-stub"></div>' },
}));

import EventInstance from '@/site/components/event-instance.vue';

const Stub = { template: '<div></div>' };

async function openLink(path: string): Promise<{ router: Router; wrapper: ReturnType<typeof mount> }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/:calendar/events/:event', component: Stub, name: 'event' },
      { path: '/:calendar/events/:event/:startTime', component: Stub, name: 'instance' },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(EventInstance, {
    global: { plugins: [router, [I18NextVue, { i18next }], createPinia()] },
  });
  await flushPromises();
  return { router, wrapper };
}

describe('event-instance.vue when the linked occurrence no longer exists', () => {
  beforeEach(() => {
    service.loadEventInstance.mockReset();
    service.loadEventForMissingOccurrence.mockReset();
    service.getCalendarByUrlName.mockResolvedValue({
      urlName: 'test_calendar',
      content: () => ({ name: 'Test Calendar' }),
      hasContent: () => true,
      getLanguages: () => ['en'],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders a found occurrence without falling back or redirecting', async () => {
    service.loadEventInstance.mockResolvedValue(fakeInstance('2026-11-15T00:00:00Z'));

    const { router, wrapper } = await openLink(LINKED_PATH);

    expect(wrapper.find('.detail-body-stub').exists()).toBe(true);
    expect(service.loadEventForMissingOccurrence).not.toHaveBeenCalled();
    expect(router.currentRoute.value.fullPath).toBe(LINKED_PATH);
  });

  it('replaces the link with the occurrence that replaced it and renders that occurrence', async () => {
    const moved = DateTime.fromISO('2026-11-14T16:30:00Z', { zone: 'utc' });
    service.loadEventInstance
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fakeInstance('2026-11-14T16:30:00Z'));
    service.loadEventForMissingOccurrence.mockResolvedValue({ event: fakeEvent(), occurrenceStart: moved });

    const { router, wrapper } = await openLink(LINKED_PATH);

    expect(router.currentRoute.value.fullPath).toBe(`/test_calendar/events/${EVENT_ID}/20261114-1630`);
    expect(wrapper.find('.detail-body-stub').exists()).toBe(true);
    expect(wrapper.find('.not-found-stub').exists()).toBe(false);
    expect(service.loadEventInstance.mock.calls[1][1].toMillis()).toBe(moved.toMillis());
    expect(document.title).toBe('Harvest Supper | Pavillion');
  });

  it('asks for the event with the link\'s calendar and its linked start', async () => {
    service.loadEventInstance.mockResolvedValue(null);
    service.loadEventForMissingOccurrence.mockResolvedValue(null);

    await openLink(LINKED_PATH);

    const [eventId, linkedStart, urlName] = service.loadEventForMissingOccurrence.mock.calls[0];
    expect(eventId).toBe(EVENT_ID);
    expect(linkedStart.toUTC().toISO()).toBe('2026-11-15T00:00:00.000Z');
    expect(urlName).toBe('test_calendar');
  });

  it('sends a date with no replacing occurrence to the undated page with the linked start in router state', async () => {
    service.loadEventInstance.mockResolvedValue(null);
    service.loadEventForMissingOccurrence.mockResolvedValue({ event: fakeEvent(), occurrenceStart: null });

    const { router } = await openLink(LINKED_PATH);

    expect(router.currentRoute.value.fullPath).toBe(`/test_calendar/events/${EVENT_ID}`);
    expect(router.options.history.state.missingOccurrence).toBe(LINKED_SLUG);
  });

  it('never replaces to the slug it was asked for (loop guard)', async () => {
    service.loadEventInstance.mockResolvedValue(null);
    service.loadEventForMissingOccurrence.mockResolvedValue({
      event: fakeEvent(),
      occurrenceStart: DateTime.fromISO('2026-11-15T00:00:00Z', { zone: 'utc' }),
    });

    const { router } = await openLink(LINKED_PATH);

    expect(service.loadEventInstance).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.fullPath).toBe(`/test_calendar/events/${EVENT_ID}`);
    expect(router.options.history.state.missingOccurrence).toBe(LINKED_SLUG);
  });

  it('sends the link to the undated page when the replacing occurrence fails to load', async () => {
    service.loadEventInstance.mockResolvedValue(null);
    service.loadEventForMissingOccurrence.mockResolvedValue({
      event: fakeEvent(),
      occurrenceStart: DateTime.fromISO('2026-11-14T16:30:00Z', { zone: 'utc' }),
    });

    const { router } = await openLink(LINKED_PATH);

    expect(router.currentRoute.value.fullPath).toBe(`/test_calendar/events/${EVENT_ID}`);
    expect(router.options.history.state.missingOccurrence).toBe(LINKED_SLUG);
  });

  it('stays Not Found when the link\'s calendar does not show the event', async () => {
    service.loadEventInstance.mockResolvedValue(null);
    service.loadEventForMissingOccurrence.mockResolvedValue(null);

    const { router, wrapper } = await openLink(LINKED_PATH);

    expect(wrapper.find('.not-found-stub').exists()).toBe(true);
    expect(router.currentRoute.value.fullPath).toBe(LINKED_PATH);
  });
});
