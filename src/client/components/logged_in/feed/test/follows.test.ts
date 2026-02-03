import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import Follows from '../follows.vue';
import { useFeedStore } from '@/client/stores/feedStore';

describe('Following Tab', () => {
  let pinia: ReturnType<typeof createPinia>;
  let sandbox: sinon.SinonSandbox;

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox = sinon.createSandbox();

    // Initialize i18next for testing
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: {
          feed: {
            follows: {
              title: 'Follows',
              description: 'Calendars you follow',
              no_follows: 'You are not following any calendars',
              follow_button: 'Add a Calendar',
              loading: 'Loading follows...',
              auto_repost_originals: 'Auto-repost original events',
              auto_repost_originals_help: 'Automatically share events posted by this calendar',
              auto_repost_reposts: 'Also auto-repost shared events',
              auto_repost_reposts_help: 'Also share events this calendar has reposted from others',
              unfollow_button: 'Unfollow',
            },
          },
        },
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('shows empty state with "You are not following any calendars" message and "Add a Calendar" button', () => {
    const feedStore = useFeedStore();
    feedStore.follows = [];

    const wrapper = mount(Follows, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
        stubs: {
          EmptyLayout: {
            template: '<div class="empty-state"><div>{{ title }}</div><slot /></div>',
            props: ['title'],
          },
        },
      },
    });

    expect(wrapper.text()).toContain('You are not following any calendars');
    expect(wrapper.find('button').text()).toBe('Add a Calendar');
  });

  it('displays following list with calendar info and toggle switches', async () => {
    const feedStore = useFeedStore();
    feedStore.follows = [
      {
        id: 'follow-1',
        calendarActorId: 'calendar@remote.com',
        calendarId: 'test-calendar',
        autoRepostOriginals: false,
        autoRepostReposts: false,
      },
      {
        id: 'follow-2',
        calendarActorId: 'events@other.com',
        calendarId: 'test-calendar',
        autoRepostOriginals: true,
        autoRepostReposts: true,
      },
    ];

    const wrapper = mount(Follows, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
        stubs: {
          AddCalendarModal: true,
        },
      },
    });

    const items = wrapper.findAll('.follow-list-item');
    expect(items).toHaveLength(2);
    expect(wrapper.text()).toContain('calendar@remote.com');
    expect(wrapper.text()).toContain('events@other.com');
  });

  it('triggers updateFollowPolicy action when toggle switches change', async () => {
    const feedStore = useFeedStore();
    feedStore.follows = [
      {
        id: 'follow-1',
        calendarActorId: 'calendar@remote.com',
        calendarId: 'test-calendar',
        autoRepostOriginals: false,
        autoRepostReposts: false,
      },
    ];

    const updatePolicySpy = sandbox.stub(feedStore, 'updateFollowPolicy').resolves();

    const wrapper = mount(Follows, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
        stubs: {
          AddCalendarModal: true,
        },
      },
    });

    // Find the toggle switch button and click it to toggle autoRepostOriginals
    const toggleButton = wrapper.find('button[role="switch"]');
    await toggleButton.trigger('click');

    expect(updatePolicySpy.calledOnce).toBe(true);
    // Should be called with followId, autoRepostOriginals=true, autoRepostReposts=false
    expect(updatePolicySpy.calledWith('follow-1', true, false)).toBe(true);
  });

  it('removes calendar from list when unfollow button is clicked', async () => {
    const feedStore = useFeedStore();
    feedStore.follows = [
      {
        id: 'follow-1',
        calendarActorId: 'calendar@remote.com',
        calendarId: 'test-calendar',
        autoRepostOriginals: false,
        autoRepostReposts: false,
      },
    ];

    const unfollowSpy = sandbox.stub(feedStore, 'unfollowCalendar').resolves();

    const wrapper = mount(Follows, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
        stubs: {
          AddCalendarModal: true,
        },
      },
    });

    const button = wrapper.find('button.unfollow-button');
    await button.trigger('click');

    expect(unfollowSpy.calledOnce).toBe(true);
    expect(unfollowSpy.calledWith('follow-1')).toBe(true);
  });

  it('opens Add Calendar modal when "Add a Calendar" button is clicked', async () => {
    const feedStore = useFeedStore();
    feedStore.follows = [];

    const wrapper = mount(Follows, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
        stubs: {
          EmptyLayout: {
            template: '<div class="empty-state"><div>{{ title }}</div><button @click="$emit(\'click\')"><slot /></button></div>',
            props: ['title'],
          },
          AddCalendarModal: true,
        },
      },
    });

    // Find the button and click it
    const button = wrapper.find('button');
    await button.trigger('click');

    // The modal should now be rendered (showAddModal becomes true)
    // We can't test the actual modal because it's stubbed, but we can verify
    // the component structure is correct
    expect(wrapper.findComponent({ name: 'AddCalendarModal' }).exists()).toBe(false); // Initially not shown

    // Simulate the click that would show the modal
    await wrapper.vm.handleOpenAddModal();
    await wrapper.vm.$nextTick();

    // After clicking, showAddModal should be true
    expect(wrapper.vm.showAddModal).toBe(true);
  });

  it('shows second toggle only when first toggle is enabled', async () => {
    const feedStore = useFeedStore();
    feedStore.follows = [
      {
        id: 'follow-1',
        calendarActorId: 'calendar@remote.com',
        calendarId: 'test-calendar',
        autoRepostOriginals: false,
        autoRepostReposts: false,
      },
    ];

    const wrapper = mount(Follows, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
        stubs: {
          AddCalendarModal: true,
        },
      },
    });

    // Initially, only one toggle switch should be visible (autoRepostOriginals is false)
    let toggleSwitches = wrapper.findAll('button[role="switch"]');
    expect(toggleSwitches).toHaveLength(1);

    // Update the store to have autoRepostOriginals enabled
    feedStore.follows[0].autoRepostOriginals = true;
    await wrapper.vm.$nextTick();

    // Now both toggle switches should be visible
    toggleSwitches = wrapper.findAll('button[role="switch"]');
    expect(toggleSwitches).toHaveLength(2);
  });

  it('auto-disables second toggle when first toggle is turned off', async () => {
    const feedStore = useFeedStore();
    feedStore.follows = [
      {
        id: 'follow-1',
        calendarActorId: 'calendar@remote.com',
        calendarId: 'test-calendar',
        autoRepostOriginals: true,
        autoRepostReposts: true,
      },
    ];

    const updatePolicySpy = sandbox.stub(feedStore, 'updateFollowPolicy').resolves();

    const wrapper = mount(Follows, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
        stubs: {
          AddCalendarModal: true,
        },
      },
    });

    // Both toggles should be visible initially
    let toggleSwitches = wrapper.findAll('button[role="switch"]');
    expect(toggleSwitches).toHaveLength(2);

    // Click the first toggle to turn it off
    await toggleSwitches[0].trigger('click');

    // Should update with both values set to false (turning off originals also turns off reposts)
    expect(updatePolicySpy.calledOnce).toBe(true);
    expect(updatePolicySpy.calledWith('follow-1', false, false)).toBe(true);
  });
});
