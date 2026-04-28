import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';

import { CalendarEvent } from '@/common/model/events';
import EventCancellationsPanel from '@/client/components/logged_in/calendar/EventCancellationsPanel.vue';
import EventCancelConfirmModal from '@/client/components/logged_in/calendar/EventCancelConfirmModal.vue';
import { mountComponent } from '@/client/test/lib/vue';

const { listUpcomingOccurrencesMock, cancelOccurrenceMock, restoreOccurrenceMock } = vi.hoisted(() => ({
  listUpcomingOccurrencesMock: vi.fn(),
  cancelOccurrenceMock: vi.fn(),
  restoreOccurrenceMock: vi.fn(),
}));

vi.mock('@/client/service/event', () => {
  class MockEventService {
    listUpcomingOccurrences = (...args: unknown[]) => listUpcomingOccurrencesMock(...args);
    cancelOccurrence = (...args: unknown[]) => cancelOccurrenceMock(...args);
    restoreOccurrence = (...args: unknown[]) => restoreOccurrenceMock(...args);
  }
  return { default: MockEventService };
});

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
];

const SheetStub = {
  template: '<div class="sheet-stub"><header><h2>{{ title }}</h2></header><slot /></div>',
  props: ['title'],
  emits: ['close'],
};

const EVENT_ID = 'event-1';

function makeRecurringEvent(): CalendarEvent {
  // The panel itself does not check hasRecurringSchedule — that gating lives
  // in edit_event.vue — so an empty schedules array is sufficient for these
  // tests. The panel fetches its data through the mocked service.
  const event = new CalendarEvent();
  event.id = EVENT_ID;
  event.calendarId = 'cal-1';
  event.schedules = [];
  return event;
}

function makeOccurrences(count: number, startIso = '2030-01-01T12:00:00.000Z'): any[] {
  const out = [];
  let current = new Date(startIso).getTime();
  const weekMs = 7 * 24 * 3600 * 1000;
  for (let i = 0; i < count; i++) {
    out.push({
      start: new Date(current).toISOString(),
      state: 'active',
      scheduleId: null,
    });
    current += weekMs;
  }
  return out;
}

async function mountPanel(props: { event: CalendarEvent }) {
  const router: Router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/');
  await router.isReady();

  return mountComponent(EventCancellationsPanel, router, {
    stubs: { Sheet: SheetStub },
    props,
  });
}

describe('EventCancellationsPanel (horizontal scroller)', () => {
  let currentWrapper: any = null;

  beforeEach(() => {
    listUpcomingOccurrencesMock.mockReset();
    cancelOccurrenceMock.mockReset();
    restoreOccurrenceMock.mockReset();
    cancelOccurrenceMock.mockResolvedValue(undefined);
    restoreOccurrenceMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
    vi.restoreAllMocks();
  });

  it('fetches 10 occurrences on mount with after=now', async () => {
    listUpcomingOccurrencesMock.mockResolvedValue({
      occurrences: makeOccurrences(10),
      hasMore: true,
    });

    const wrapper = await mountPanel({ event: makeRecurringEvent() });
    currentWrapper = wrapper;
    await flushPromises();

    expect(listUpcomingOccurrencesMock).toHaveBeenCalledTimes(1);
    const [eventId, after, limit] = listUpcomingOccurrencesMock.mock.calls[0];
    expect(eventId).toBe(EVENT_ID);
    expect(typeof after).toBe('string');
    expect(limit).toBe(10);

    const cards = wrapper.findAll('[data-testid="occurrence-card"]');
    expect(cards).toHaveLength(10);
    // Trailing control cards exist alongside.
    expect(wrapper.find('[data-testid="scroller-jump-card"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="scroller-show-more-card"]').exists()).toBe(true);
  });

  it('"Show more" appends the next 10 occurrences keyed off the last card', async () => {
    const firstBatch = makeOccurrences(10);
    const secondBatch = makeOccurrences(10, '2030-03-12T12:00:00.000Z');
    listUpcomingOccurrencesMock
      .mockResolvedValueOnce({ occurrences: firstBatch, hasMore: true })
      .mockResolvedValueOnce({ occurrences: secondBatch, hasMore: false });

    const wrapper = await mountPanel({ event: makeRecurringEvent() });
    currentWrapper = wrapper;
    await flushPromises();

    await wrapper.find('[data-testid="scroller-show-more-card"]').trigger('click');
    await flushPromises();

    const call = listUpcomingOccurrencesMock.mock.calls[1];
    expect(call[0]).toBe(EVENT_ID);
    expect(call[1]).toBe(firstBatch[firstBatch.length - 1].start);
    expect(call[2]).toBe(10);

    expect(wrapper.findAll('[data-testid="occurrence-card"]')).toHaveLength(20);

    // hasMore=false replaces the Show More card with the terminal card.
    expect(wrapper.find('[data-testid="scroller-show-more-card"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="scroller-terminal-card"]').exists()).toBe(true);
  });

  it('"Jump to month" replaces the list and resets scroll', async () => {
    const firstBatch = makeOccurrences(10);
    const jumped = makeOccurrences(10, '2027-06-07T12:00:00.000Z');
    listUpcomingOccurrencesMock
      .mockResolvedValueOnce({ occurrences: firstBatch, hasMore: true })
      .mockResolvedValueOnce({ occurrences: jumped, hasMore: true });

    const wrapper = await mountPanel({ event: makeRecurringEvent() });
    currentWrapper = wrapper;
    await flushPromises();

    await wrapper.find('[data-testid="scroller-jump-input"]').setValue('2027-06');
    await wrapper.find('[data-testid="scroller-jump-submit"]').trigger('click');
    await flushPromises();

    const call = listUpcomingOccurrencesMock.mock.calls[1];
    expect(call[1]).toBe('2027-06-01T00:00:00.000Z');

    expect(wrapper.findAll('[data-testid="occurrence-card"]')).toHaveLength(10);
  });

  it('renders a "no occurrences after" card when jump returns empty', async () => {
    listUpcomingOccurrencesMock
      .mockResolvedValueOnce({ occurrences: makeOccurrences(10), hasMore: true })
      .mockResolvedValueOnce({ occurrences: [], hasMore: false })
      .mockResolvedValueOnce({ occurrences: makeOccurrences(10), hasMore: false });

    const wrapper = await mountPanel({ event: makeRecurringEvent() });
    currentWrapper = wrapper;
    await flushPromises();

    await wrapper.find('[data-testid="scroller-jump-input"]').setValue('2099-01');
    await wrapper.find('[data-testid="scroller-jump-submit"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="scroller-empty-card"]').exists()).toBe(true);
    await wrapper.find('[data-testid="scroller-start-from-today"]').trigger('click');
    await flushPromises();

    // A third call restores the "start from today" view.
    expect(listUpcomingOccurrencesMock).toHaveBeenCalledTimes(3);
  });

  it('opens the confirm modal and cancels via cancelOccurrence on confirm', async () => {
    const occ = makeOccurrences(1)[0];
    listUpcomingOccurrencesMock.mockResolvedValue({ occurrences: [occ], hasMore: false });

    const wrapper = await mountPanel({ event: makeRecurringEvent() });
    currentWrapper = wrapper;
    await flushPromises();

    await wrapper.find('[data-testid="occurrence-card-cancel"]').trigger('click');
    await flushPromises();

    const modal = wrapper.findComponent(EventCancelConfirmModal);
    expect(modal.exists()).toBe(true);
    modal.vm.$emit('confirm', { hideFromPublic: true });
    await flushPromises();

    expect(cancelOccurrenceMock).toHaveBeenCalledWith(EVENT_ID, occ.start, true);
    // Card state flips in place — still one card, but now shows restore action.
    const cards = wrapper.findAll('[data-testid="occurrence-card"]');
    expect(cards).toHaveLength(1);
    expect(wrapper.find('[data-testid="occurrence-card-restore"]').exists()).toBe(true);

    // State flip must NOT re-fetch — single-call assertion (advisor binding).
    expect(listUpcomingOccurrencesMock).toHaveBeenCalledTimes(1);
  });

  it('restores via restoreOccurrence and flips state to active in place', async () => {
    const occ = { start: '2030-01-01T12:00:00.000Z', state: 'cancelled-shown', scheduleId: 'sch-1' };
    listUpcomingOccurrencesMock.mockResolvedValue({ occurrences: [occ], hasMore: false });

    const wrapper = await mountPanel({ event: makeRecurringEvent() });
    currentWrapper = wrapper;
    await flushPromises();

    await wrapper.find('[data-testid="occurrence-card-restore"]').trigger('click');
    await flushPromises();

    expect(restoreOccurrenceMock).toHaveBeenCalledWith(EVENT_ID, occ.start);
    expect(wrapper.find('[data-testid="occurrence-card-cancel"]').exists()).toBe(true);

    // State flip must NOT re-fetch — single-call assertion (advisor binding).
    expect(listUpcomingOccurrencesMock).toHaveBeenCalledTimes(1);
  });

  it('supports arrow-key focus navigation across cards (LTR)', async () => {
    listUpcomingOccurrencesMock.mockResolvedValue({
      occurrences: makeOccurrences(3),
      hasMore: false,
    });

    const wrapper = await mountPanel({ event: makeRecurringEvent() });
    currentWrapper = wrapper;
    await flushPromises();

    const cards = wrapper.findAll('[data-testid="occurrence-card"]');
    expect(cards.length).toBeGreaterThan(1);

    // Attach the first card to the document and focus it so keydown has a target.
    const firstEl = cards[0].element as HTMLElement;
    document.body.appendChild(wrapper.element);
    firstEl.focus();
    expect(document.activeElement).toBe(firstEl);

    await cards[0].trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();
    expect(document.activeElement).toBe(cards[1].element as HTMLElement);

    await cards[1].trigger('keydown', { key: 'ArrowLeft' });
    await flushPromises();
    expect(document.activeElement).toBe(cards[0].element as HTMLElement);
  });
});
