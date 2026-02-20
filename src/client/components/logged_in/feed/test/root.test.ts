import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { nextTick } from 'vue';
import { mountComponent } from '@/client/test/lib/vue';
import Root from '../root.vue';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';

const routes = [
  { path: '/feed', component: {}, name: 'feed' },
];

describe('Feed Root Component', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('should show calendar selector when user has multiple calendars', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const calendarStore = useCalendarStore();
    const calendar1 = new Calendar('cal-1', 'calendar-1');
    const calendar2 = new Calendar('cal-2', 'calendar-2');
    calendarStore.setCalendars([calendar1, calendar2]);

    const router = createRouter({
      history: createMemoryHistory(),
      routes,
    });

    const wrapper = mountComponent(Root, router, {
      pinia,
      stubs: {
        FollowsView: true,
        FollowersView: true,
        FollowedEventsView: true,
      },
    });

    await nextTick();

    const selector = wrapper.find('[data-testid="calendar-selector"]');
    expect(selector.exists()).toBe(true);
  });

  it('should hide calendar selector when user has single calendar', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const calendarStore = useCalendarStore();
    const calendar1 = new Calendar('cal-1', 'calendar-1');
    calendarStore.setCalendars([calendar1]);

    const router = createRouter({
      history: createMemoryHistory(),
      routes,
    });

    const wrapper = mountComponent(Root, router, {
      pinia,
      stubs: {
        FollowsView: true,
        FollowersView: true,
        FollowedEventsView: true,
      },
    });

    await nextTick();

    const selector = wrapper.find('[data-testid="calendar-selector"]');
    expect(selector.exists()).toBe(false);
  });

  it('should switch tabs correctly', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const calendarStore = useCalendarStore();
    const calendar1 = new Calendar('cal-1', 'calendar-1');
    calendarStore.setCalendars([calendar1]);

    const router = createRouter({
      history: createMemoryHistory(),
      routes,
    });

    const wrapper = mountComponent(Root, router, {
      pinia,
      stubs: {
        FollowsView: true,
        FollowersView: true,
        FollowedEventsView: true,
      },
    });

    await nextTick();

    // Initially on events tab
    expect(wrapper.vm.state.activeTab).toBe('events');

    // Click follows tab
    const followsTab = wrapper.findAll('button[role="tab"]')[1];
    await followsTab.trigger('click');
    await nextTick();

    expect(wrapper.vm.state.activeTab).toBe('follows');
  });

  it('should have nextTick imported and working for tab switching', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const calendarStore = useCalendarStore();
    const calendar1 = new Calendar('cal-1', 'calendar-1');
    calendarStore.setCalendars([calendar1]);

    const router = createRouter({
      history: createMemoryHistory(),
      routes,
    });

    const wrapper = mountComponent(Root, router, {
      pinia,
      stubs: {
        FollowsView: true,
        FollowersView: true,
        FollowedEventsView: true,
      },
    });

    await nextTick();

    // Click followers tab
    const followersTab = wrapper.findAll('button[role="tab"]')[2];
    await followersTab.trigger('click');
    await nextTick();

    // Verify tab switched (this confirms nextTick is imported and working)
    expect(wrapper.vm.state.activeTab).toBe('followers');

    // Verify the follower panel is visible
    const followerPanel = wrapper.find('#followers-panel');
    expect(followerPanel.attributes('hidden')).toBeUndefined();
  });

  it('should switch to follows tab and set openAddCalendarModal flag when handleFollowCalendarRequest is called', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const calendarStore = useCalendarStore();
    const calendar1 = new Calendar('cal-1', 'calendar-1');
    calendarStore.setCalendars([calendar1]);

    const router = createRouter({
      history: createMemoryHistory(),
      routes,
    });

    const wrapper = mountComponent(Root, router, {
      pinia,
      stubs: {
        FollowsView: true,
        FollowersView: true,
        FollowedEventsView: true,
      },
    });

    await nextTick();

    // Initially on events tab with modal flag false
    expect(wrapper.vm.state.activeTab).toBe('events');
    expect(wrapper.vm.openAddCalendarModal).toBe(false);

    // Trigger the follow calendar request
    await wrapper.vm.handleFollowCalendarRequest();
    await nextTick();

    // Should have switched to follows tab
    expect(wrapper.vm.state.activeTab).toBe('follows');
    // Should have set the modal flag
    expect(wrapper.vm.openAddCalendarModal).toBe(true);
  });

  it('should reset openAddCalendarModal flag when handleAddCalendarModalOpened is called', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const calendarStore = useCalendarStore();
    const calendar1 = new Calendar('cal-1', 'calendar-1');
    calendarStore.setCalendars([calendar1]);

    const router = createRouter({
      history: createMemoryHistory(),
      routes,
    });

    const wrapper = mountComponent(Root, router, {
      pinia,
      stubs: {
        FollowsView: true,
        FollowersView: true,
        FollowedEventsView: true,
      },
    });

    await nextTick();

    // Set up: trigger follow calendar request first
    await wrapper.vm.handleFollowCalendarRequest();
    await nextTick();
    expect(wrapper.vm.openAddCalendarModal).toBe(true);

    // Now simulate follows.vue acknowledging it opened
    await wrapper.vm.handleAddCalendarModalOpened();
    await nextTick();

    // Flag should be reset
    expect(wrapper.vm.openAddCalendarModal).toBe(false);
  });
});
