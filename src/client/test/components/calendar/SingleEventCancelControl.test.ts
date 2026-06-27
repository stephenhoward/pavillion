import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { DateTime } from 'luxon';

import { CalendarEvent, CalendarEventSchedule } from '@/common/model/events';
import SingleEventCancelControl from '@/client/components/logged_in/calendar/SingleEventCancelControl.vue';
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
const START_ISO = '2030-01-01T12:00:00.000Z';

// One instant shared by the fixture and the assertions so the ISO strings the
// component derives via luxon match exactly regardless of the host timezone.
const startDate = DateTime.fromISO(START_ISO);
const expectedAfter = startDate.minus({ milliseconds: 1 }).toISO();
const expectedStart = startDate.toISO();

/**
 * A single (non-recurring) event: exactly one positive schedule that
 * materializes one occurrence. `extraExclusion` adds an exclusion (EXDATE)
 * row to prove the occurrenceStart computation filters it out.
 */
function makeSingleEvent(extraExclusion = false): CalendarEvent {
  const event = new CalendarEvent();
  event.id = EVENT_ID;
  event.calendarId = 'cal-1';
  const positive = new CalendarEventSchedule('sched-1', startDate);
  const schedules = [positive];
  if (extraExclusion) {
    const exclusion = new CalendarEventSchedule('sched-exdate', startDate);
    exclusion.isExclusion = true;
    schedules.push(exclusion);
  }
  event.schedules = schedules;
  return event;
}

function makeOccurrence(state: 'active' | 'cancelled-shown' | 'hidden') {
  return { start: expectedStart, state, scheduleId: state === 'active' ? null : 'sch-1' };
}

async function mountControl(event: CalendarEvent) {
  const router: Router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/');
  await router.isReady();

  return mountComponent(SingleEventCancelControl, router, {
    stubs: { Sheet: SheetStub },
    props: { event },
  });
}

describe('SingleEventCancelControl', () => {
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

  it('renders the Cancel trigger for an active single event', async () => {
    listUpcomingOccurrencesMock.mockResolvedValue({ occurrences: [makeOccurrence('active')], hasMore: false });

    const wrapper = await mountControl(makeSingleEvent());
    currentWrapper = wrapper;
    await flushPromises();

    expect(wrapper.find('[data-testid="single-event-cancel"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="single-event-restore"]').exists()).toBe(false);
  });

  it('anchors the state read one millisecond before the lone positive schedule start, ignoring exclusion rows', async () => {
    listUpcomingOccurrencesMock.mockResolvedValue({ occurrences: [makeOccurrence('active')], hasMore: false });

    // An exclusion (EXDATE) row is present; occurrenceStart must still resolve
    // to the single POSITIVE schedule's start (!isExclusion filter).
    const wrapper = await mountControl(makeSingleEvent(true));
    currentWrapper = wrapper;
    await flushPromises();

    expect(listUpcomingOccurrencesMock).toHaveBeenCalledTimes(1);
    const [eventId, after, limit] = listUpcomingOccurrencesMock.mock.calls[0];
    expect(eventId).toBe(EVENT_ID);
    expect(after).toBe(expectedAfter);
    expect(limit).toBe(1);
    // Active state still renders, proving the exclusion row did not derail gating.
    expect(wrapper.find('[data-testid="single-event-cancel"]').exists()).toBe(true);
  });

  it('opens EventCancelConfirmModal without the hide-from-public toggle (allowHide=false)', async () => {
    listUpcomingOccurrencesMock.mockResolvedValue({ occurrences: [makeOccurrence('active')], hasMore: false });

    const wrapper = await mountControl(makeSingleEvent());
    currentWrapper = wrapper;
    await flushPromises();

    expect(wrapper.findComponent(EventCancelConfirmModal).exists()).toBe(false);

    await wrapper.find('[data-testid="single-event-cancel"]').trigger('click');
    await flushPromises();

    const modal = wrapper.findComponent(EventCancelConfirmModal);
    expect(modal.exists()).toBe(true);
    expect(modal.props('allowHide')).toBe(false);
  });

  it('cancels via cancelOccurrence(id, start, false) and flips to cancelled-shown in place', async () => {
    listUpcomingOccurrencesMock.mockResolvedValue({ occurrences: [makeOccurrence('active')], hasMore: false });

    const wrapper = await mountControl(makeSingleEvent());
    currentWrapper = wrapper;
    await flushPromises();

    await wrapper.find('[data-testid="single-event-cancel"]').trigger('click');
    await flushPromises();

    const modal = wrapper.findComponent(EventCancelConfirmModal);
    modal.vm.$emit('confirm', { hideFromPublic: false });
    await flushPromises();

    // Show-as-cancelled only: hideFromPublic is always false.
    expect(cancelOccurrenceMock).toHaveBeenCalledWith(EVENT_ID, expectedStart, false);

    // State flips in place to cancelled — Restore replaces Cancel, status shows.
    expect(wrapper.find('[data-testid="single-event-cancel"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="single-event-restore"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="single-event-cancelled-status"]').text()).not.toBe('');

    // The flip must NOT re-fetch — the read happened once on mount.
    expect(listUpcomingOccurrencesMock).toHaveBeenCalledTimes(1);
  });

  it('restores via restoreOccurrence and flips back to active in place', async () => {
    listUpcomingOccurrencesMock.mockResolvedValue({ occurrences: [makeOccurrence('cancelled-shown')], hasMore: false });

    const wrapper = await mountControl(makeSingleEvent());
    currentWrapper = wrapper;
    await flushPromises();

    expect(wrapper.find('[data-testid="single-event-restore"]').exists()).toBe(true);

    await wrapper.find('[data-testid="single-event-restore"]').trigger('click');
    await flushPromises();

    expect(restoreOccurrenceMock).toHaveBeenCalledWith(EVENT_ID, expectedStart);
    expect(wrapper.find('[data-testid="single-event-cancel"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="single-event-restore"]').exists()).toBe(false);

    expect(listUpcomingOccurrencesMock).toHaveBeenCalledTimes(1);
  });

  it('treats a legacy hidden occurrence as cancelled (Restore + status, no Cancel)', async () => {
    listUpcomingOccurrencesMock.mockResolvedValue({ occurrences: [makeOccurrence('hidden')], hasMore: false });

    const wrapper = await mountControl(makeSingleEvent());
    currentWrapper = wrapper;
    await flushPromises();

    expect(wrapper.find('[data-testid="single-event-cancel"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="single-event-restore"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="single-event-cancelled-status"]').text()).not.toBe('');
  });

  it('renders no action controls while the state read is pending (loading)', async () => {
    // Never resolves: the component stays in its null/loading state.
    listUpcomingOccurrencesMock.mockReturnValue(new Promise(() => {}));

    const wrapper = await mountControl(makeSingleEvent());
    currentWrapper = wrapper;
    await flushPromises();

    expect(wrapper.find('[data-testid="single-event-cancel"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="single-event-restore"]').exists()).toBe(false);
    // The live region is present but empty while loading.
    expect(wrapper.find('[data-testid="single-event-cancelled-status"]').text()).toBe('');
  });

  it('always renders the role="status" live region, with text reflecting state', async () => {
    listUpcomingOccurrencesMock.mockResolvedValue({ occurrences: [makeOccurrence('active')], hasMore: false });

    const wrapper = await mountControl(makeSingleEvent());
    currentWrapper = wrapper;
    await flushPromises();

    // Present and empty while active so the change is announced on cancel.
    const liveRegion = wrapper.find('[role="status"]');
    expect(liveRegion.exists()).toBe(true);
    expect(liveRegion.text()).toBe('');

    await wrapper.find('[data-testid="single-event-cancel"]').trigger('click');
    await flushPromises();
    wrapper.findComponent(EventCancelConfirmModal).vm.$emit('confirm', { hideFromPublic: false });
    await flushPromises();

    // Same element instance, now populated — never toggled in/out of the DOM.
    const after = wrapper.find('[role="status"]');
    expect(after.exists()).toBe(true);
    expect(after.text()).not.toBe('');
  });
});
