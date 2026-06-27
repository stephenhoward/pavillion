import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { CalendarEvent } from '@/common/model/events';
import type { FeedEvent } from '@/client/service/feed';
import FeedEventDetailModal from '@/client/components/logged_in/feed/feed-event-detail-modal.vue';

const FEED_EVENTS_TRANSLATIONS: Record<string, string> = {
  untitled_event: 'Untitled event',
  unknown_calendar: 'Unknown calendar',
  close_aria_label: 'Close',
  repost_button: 'Repost',
  repost_aria_label: 'Repost {{eventTitle}}',
  reposted_button: 'Reposted',
  unrepost_aria_label: 'Unrepost {{eventTitle}}',
  auto_posted_label: 'Auto-posted',
  report_button: 'Report',
  report_aria_label: 'Report {{eventTitle}}',
};

/**
 * Build a FeedEvent with the given repost status. Uses CalendarEvent.fromObject
 * so the `content(lang)` accessor behaves like production data.
 */
const makeEvent = (
  repostStatus: FeedEvent['repostStatus'] = 'none',
): FeedEvent => {
  const event = CalendarEvent.fromObject({
    id: 'event-1',
    calendarId: 'remote-cal-1',
    date: '2025-12-27',
    content: {
      en: {
        language: 'en',
        name: 'Community Potluck',
        description: 'A shared meal in the park.',
      },
    },
  });
  return Object.assign(event, {
    repostStatus,
    sourceCalendarActorId: 'https://remote.example/calendars/community',
  }) as unknown as FeedEvent;
};

const mountModal = (event: FeedEvent): VueWrapper => {
  return mount(FeedEventDetailModal, {
    global: {
      plugins: [[I18NextVue, { i18next }]],
    },
    props: { event },
  });
};

describe('FeedEventDetailModal', () => {
  beforeAll(async () => {
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: {
          feed: {
            events: FEED_EVENTS_TRANSLATIONS,
          },
        },
      },
    });
  });

  beforeEach(() => {
    // happy-dom/jsdom do not implement native <dialog> showModal()/close().
    // Toggle the `open` property so useDialog's open/close guards stay faithful.
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(
      function (this: HTMLDialogElement) {
        this.open = true;
      },
    );
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(
      function (this: HTMLDialogElement) {
        this.open = false;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.classList.remove('modal-open');
  });

  it('opens the dialog on mount', async () => {
    const showModalSpy = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const wrapper = mountModal(makeEvent());
    await flushPromises();

    const dialog = wrapper.find('dialog');
    expect(dialog.exists()).toBe(true);
    expect(showModalSpy).toHaveBeenCalled();
    expect((dialog.element as HTMLDialogElement).open).toBe(true);
    wrapper.unmount();
  });

  it('renders the event title, date, location and description', async () => {
    const event = makeEvent();
    Object.assign(event, { location: { name: 'Riverside Park' } });
    const wrapper = mountModal(event);
    await flushPromises();

    expect(wrapper.find('.feed-detail-dialog__title').text()).toBe('Community Potluck');
    expect(wrapper.find('.feed-detail-dialog__description').text()).toBe('A shared meal in the park.');
    expect(wrapper.find('.feed-detail-dialog__location').text()).toBe('Riverside Park');
    expect(wrapper.find('.feed-detail-dialog__date').exists()).toBe(true);
    wrapper.unmount();
  });

  it('associates aria-labelledby with the heading id and marks the heading focusable', async () => {
    const wrapper = mountModal(makeEvent());
    await flushPromises();

    const dialog = wrapper.find('dialog');
    const heading = wrapper.find('.feed-detail-dialog__title');
    const labelledBy = dialog.attributes('aria-labelledby');

    expect(labelledBy).toBeTruthy();
    expect(heading.attributes('id')).toBe(labelledBy);
    expect(heading.attributes('tabindex')).toBe('-1');
    wrapper.unmount();
  });

  it('emits close and closes the dialog when the close button is clicked', async () => {
    const wrapper = mountModal(makeEvent());
    await flushPromises();

    await wrapper.find('.feed-detail-dialog__close').trigger('click');

    expect(wrapper.emitted('close')).toBeTruthy();
    expect((wrapper.find('dialog').element as HTMLDialogElement).open).toBe(false);
    wrapper.unmount();
  });

  it('closes when the backdrop (dialog element itself) is clicked', async () => {
    const wrapper = mountModal(makeEvent());
    await flushPromises();

    const dialog = wrapper.find('dialog');
    // A click whose target is the dialog element itself is a backdrop click.
    await dialog.trigger('click');

    expect(wrapper.emitted('close')).toBeTruthy();
    expect((dialog.element as HTMLDialogElement).open).toBe(false);
    wrapper.unmount();
  });

  it('does not close when a click originates on inner dialog content', async () => {
    const wrapper = mountModal(makeEvent());
    await flushPromises();

    // Clicking an inner child sets event.target to that child, not the dialog,
    // so the backdrop guard must leave the dialog open.
    await wrapper.find('.feed-detail-dialog__content').trigger('click');

    expect(wrapper.emitted('close')).toBeFalsy();
    expect((wrapper.find('dialog').element as HTMLDialogElement).open).toBe(true);
    wrapper.unmount();
  });

  it('closes when Escape is pressed on the dialog', async () => {
    const wrapper = mountModal(makeEvent());
    await flushPromises();

    const dialog = wrapper.find('dialog');
    await dialog.trigger('keydown.esc');

    expect(wrapper.emitted('close')).toBeTruthy();
    expect((dialog.element as HTMLDialogElement).open).toBe(false);
    wrapper.unmount();
  });

  it('adds the modal-open body class on open and removes it on unmount', async () => {
    const wrapper = mountModal(makeEvent());
    await flushPromises();

    expect(document.body.classList.contains('modal-open')).toBe(true);

    wrapper.unmount();
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });

  it('emits repost with the DOM event when repostStatus is "none"', async () => {
    const wrapper = mountModal(makeEvent('none'));
    await flushPromises();

    const button = wrapper.find('[data-testid="modal-repost-button"]');
    expect(button.exists()).toBe(true);
    await button.trigger('click');

    const emitted = wrapper.emitted('repost');
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBeInstanceOf(MouseEvent);
    wrapper.unmount();
  });

  it('emits unrepost when the reposted label is clicked and repostStatus is "manual"', async () => {
    const wrapper = mountModal(makeEvent('manual'));
    await flushPromises();

    const label = wrapper.find('[data-testid="modal-reposted-label"]');
    expect(label.exists()).toBe(true);
    await label.trigger('click');

    expect(wrapper.emitted('unrepost')).toBeTruthy();
    wrapper.unmount();
  });

  it('shows a non-interactive auto-posted label when repostStatus is "auto"', async () => {
    const wrapper = mountModal(makeEvent('auto'));
    await flushPromises();

    expect(wrapper.find('[data-testid="modal-auto-posted-label"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="modal-repost-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="modal-reposted-label"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('emits report with the DOM event when the report button is clicked', async () => {
    const wrapper = mountModal(makeEvent());
    await flushPromises();

    const button = wrapper.find('[data-testid="modal-report-button"]');
    expect(button.exists()).toBe(true);
    await button.trigger('click');

    const emitted = wrapper.emitted('report');
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBeInstanceOf(MouseEvent);
    wrapper.unmount();
  });
});
