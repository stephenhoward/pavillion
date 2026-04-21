import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { DateTime } from 'luxon';

import { CalendarEvent, CalendarEventSchedule } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import EventCancellationsPanel from '@/client/components/logged_in/calendar/EventCancellationsPanel.vue';
import EventCancelConfirmModal from '@/client/components/logged_in/calendar/EventCancelConfirmModal.vue';
import { mountComponent } from '@/client/test/lib/vue';

// Hoist the spies so the vi.mock factory (which is itself hoisted) can
// reference them without hitting the temporal dead zone.
const { cancelEventInstanceMock, restoreEventInstanceMock } = vi.hoisted(() => ({
  cancelEventInstanceMock: vi.fn(),
  restoreEventInstanceMock: vi.fn(),
}));

// Mock the EventService so the panel's service calls are observable without
// hitting network. The mock is defined as a default-exported class so the
// panel can instantiate it via `new EventService()`. Use a real class so
// that `new EventService()` returns an instance carrying the spy methods —
// `vi.fn().mockImplementation(() => ({...}))` does not consistently
// honor the returned object when invoked as a constructor.
vi.mock('@/client/service/event', () => {
  class MockEventService {
    cancelEventInstance = (...args: unknown[]) => cancelEventInstanceMock(...args);
    restoreEventInstance = (...args: unknown[]) => restoreEventInstanceMock(...args);
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
const CALENDAR_ID = 'cal-1';

function makeEvent(schedules: CalendarEventSchedule[] = []): CalendarEvent {
  const event = new CalendarEvent();
  event.id = EVENT_ID;
  event.calendarId = CALENDAR_ID;
  event.schedules = schedules;
  return event;
}

function makeInstance(id: string, start: DateTime, event: CalendarEvent, isCancelled = false): CalendarEventInstance {
  const instance = new CalendarEventInstance(id, event, start, null);
  instance.isCancelled = isCancelled;
  return instance;
}

function makeHiddenSchedule(start: DateTime): CalendarEventSchedule {
  const schedule = new CalendarEventSchedule('sched-hidden-' + start.toMillis(), start);
  schedule.isExclusion = true;
  schedule.hideFromPublic = true;
  return schedule;
}

async function mountPanel(props: {
  event: CalendarEvent;
  instances: CalendarEventInstance[];
}) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  await router.push('/');
  await router.isReady();

  return mountComponent(EventCancellationsPanel, router, {
    stubs: { Sheet: SheetStub },
    props,
  });
}

describe('EventCancellationsPanel', () => {
  let currentWrapper: any = null;

  beforeEach(() => {
    cancelEventInstanceMock.mockReset();
    restoreEventInstanceMock.mockReset();
    cancelEventInstanceMock.mockResolvedValue(null);
    restoreEventInstanceMock.mockResolvedValue(null);
  });

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('renders the empty-state message when there are no upcoming instances or hidden exclusions', async () => {
      const event = makeEvent();
      const wrapper = await mountPanel({ event, instances: [] });
      currentWrapper = wrapper;
      await flushPromises();

      expect(wrapper.text()).toContain('No upcoming instances to cancel.');
    });

    it('renders an item for each active instance with a cancel button and no badge', async () => {
      const event = makeEvent();
      const instances = [
        makeInstance('inst-a', DateTime.fromISO('2030-01-01T12:00:00Z'), event),
        makeInstance('inst-b', DateTime.fromISO('2030-01-08T12:00:00Z'), event),
      ];
      const wrapper = await mountPanel({ event, instances });
      currentWrapper = wrapper;
      await flushPromises();

      const items = wrapper.findAll('[data-testid="cancellations-item"]');
      expect(items).toHaveLength(2);

      // No cancelled/hidden badges on active instances
      expect(wrapper.find('[data-testid="badge-cancelled"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="badge-hidden"]').exists()).toBe(false);

      // Each active row offers a cancel button
      const cancelButtons = wrapper.findAll('[data-testid="cancel-instance-button"]');
      expect(cancelButtons).toHaveLength(2);
    });

    it('renders a cancelled badge and restore button for cancelled-shown instances', async () => {
      const event = makeEvent();
      const instances = [
        makeInstance('inst-cancelled', DateTime.fromISO('2030-02-01T12:00:00Z'), event, true),
      ];
      const wrapper = await mountPanel({ event, instances });
      currentWrapper = wrapper;
      await flushPromises();

      expect(wrapper.find('[data-testid="badge-cancelled"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="restore-instance-button"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="cancel-instance-button"]').exists()).toBe(false);
    });

    it('renders a hidden badge for exclusion schedules with hideFromPublic=true', async () => {
      const hiddenStart = DateTime.fromISO('2030-03-01T12:00:00Z');
      const event = makeEvent([makeHiddenSchedule(hiddenStart)]);
      const wrapper = await mountPanel({ event, instances: [] });
      currentWrapper = wrapper;
      await flushPromises();

      expect(wrapper.find('[data-testid="badge-hidden"]').exists()).toBe(true);
    });

    it('renders mixed active / cancelled-shown / hidden rows together', async () => {
      const event = makeEvent([
        makeHiddenSchedule(DateTime.fromISO('2030-04-01T12:00:00Z')),
      ]);
      const instances = [
        makeInstance('inst-active', DateTime.fromISO('2030-05-01T12:00:00Z'), event),
        makeInstance('inst-cancelled', DateTime.fromISO('2030-06-01T12:00:00Z'), event, true),
      ];
      const wrapper = await mountPanel({ event, instances });
      currentWrapper = wrapper;
      await flushPromises();

      const items = wrapper.findAll('[data-testid="cancellations-item"]');
      expect(items).toHaveLength(3);

      expect(wrapper.find('[data-testid="badge-hidden"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="badge-cancelled"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="cancel-instance-button"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="restore-instance-button"]').exists()).toBe(true);
    });
  });

  describe('cancel flow', () => {
    it('opens EventCancelConfirmModal when cancel button is clicked', async () => {
      const event = makeEvent();
      const instances = [
        makeInstance('inst-a', DateTime.fromISO('2030-01-01T12:00:00Z'), event),
      ];
      const wrapper = await mountPanel({ event, instances });
      currentWrapper = wrapper;
      await flushPromises();

      // Modal is not rendered initially
      expect(wrapper.findComponent(EventCancelConfirmModal).exists()).toBe(false);

      await wrapper.find('[data-testid="cancel-instance-button"]').trigger('click');
      await flushPromises();

      expect(wrapper.findComponent(EventCancelConfirmModal).exists()).toBe(true);
    });

    it('calls cancelEventInstance with emitted payload when the modal confirms', async () => {
      const event = makeEvent();
      const instances = [
        makeInstance('inst-a', DateTime.fromISO('2030-01-01T12:00:00Z'), event),
      ];
      const wrapper = await mountPanel({ event, instances });
      currentWrapper = wrapper;
      await flushPromises();

      await wrapper.find('[data-testid="cancel-instance-button"]').trigger('click');
      await flushPromises();

      const modal = wrapper.findComponent(EventCancelConfirmModal);
      expect(modal.exists()).toBe(true);
      modal.vm.$emit('confirm', { hideFromPublic: true });
      await flushPromises();

      expect(cancelEventInstanceMock).toHaveBeenCalledTimes(1);
      expect(cancelEventInstanceMock).toHaveBeenCalledWith(EVENT_ID, 'inst-a', true);

      // Modal closes after confirm
      expect(wrapper.findComponent(EventCancelConfirmModal).exists()).toBe(false);
    });

    it('closes the modal and does not call the service when the modal emits close', async () => {
      const event = makeEvent();
      const instances = [
        makeInstance('inst-a', DateTime.fromISO('2030-01-01T12:00:00Z'), event),
      ];
      const wrapper = await mountPanel({ event, instances });
      currentWrapper = wrapper;
      await flushPromises();

      await wrapper.find('[data-testid="cancel-instance-button"]').trigger('click');
      await flushPromises();

      const modal = wrapper.findComponent(EventCancelConfirmModal);
      modal.vm.$emit('close');
      await flushPromises();

      expect(cancelEventInstanceMock).not.toHaveBeenCalled();
      expect(wrapper.findComponent(EventCancelConfirmModal).exists()).toBe(false);
    });

    it('propagates hideFromPublic=false when the modal confirms without toggling the checkbox', async () => {
      const event = makeEvent();
      const instances = [
        makeInstance('inst-a', DateTime.fromISO('2030-01-01T12:00:00Z'), event),
      ];
      const wrapper = await mountPanel({ event, instances });
      currentWrapper = wrapper;
      await flushPromises();

      await wrapper.find('[data-testid="cancel-instance-button"]').trigger('click');
      await flushPromises();

      const modal = wrapper.findComponent(EventCancelConfirmModal);
      modal.vm.$emit('confirm', { hideFromPublic: false });
      await flushPromises();

      expect(cancelEventInstanceMock).toHaveBeenCalledWith(EVENT_ID, 'inst-a', false);
    });
  });

  describe('restore flow', () => {
    it('calls restoreEventInstance directly when restore button is clicked (no modal)', async () => {
      const event = makeEvent();
      const instances = [
        makeInstance('inst-cancelled', DateTime.fromISO('2030-02-01T12:00:00Z'), event, true),
      ];
      const wrapper = await mountPanel({ event, instances });
      currentWrapper = wrapper;
      await flushPromises();

      await wrapper.find('[data-testid="restore-instance-button"]').trigger('click');
      await flushPromises();

      expect(restoreEventInstanceMock).toHaveBeenCalledTimes(1);
      expect(restoreEventInstanceMock).toHaveBeenCalledWith(EVENT_ID, 'inst-cancelled');
      expect(wrapper.findComponent(EventCancelConfirmModal).exists()).toBe(false);
    });
  });
});
