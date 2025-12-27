import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import Followers from '../followers.vue';
import { useFeedStore } from '@/client/stores/feedStore';
import type { FollowerRelationship } from '@/client/service/feed';

describe('Followers Tab', () => {
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
            followers: {
              title: 'Followers',
              description: 'People who follow you',
              no_followers: 'You have no followers',
              loading: 'Loading followers...',
            },
          },
        },
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should show empty state when there are no followers', () => {
    const feedStore = useFeedStore();
    feedStore.followers = [];
    feedStore.loading.followers = false;

    const wrapper = mount(Followers, {
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

    // Should show empty state message
    expect(wrapper.text()).toContain('You have no followers');

    // Should NOT have an action button (unlike Following tab)
    const buttons = wrapper.findAll('button');
    expect(buttons.length).toBe(0);
  });

  it('should display list of followers with remote identifiers', async () => {
    const feedStore = useFeedStore();

    // Mock followers data
    const mockFollowers: FollowerRelationship[] = [
      {
        id: 'follower-1',
        remoteCalendarId: 'test@example.com',
      },
      {
        id: 'follower-2',
        remoteCalendarId: 'calendar@remote.org',
      },
    ];

    feedStore.followers = mockFollowers;
    feedStore.loading.followers = false;

    const wrapper = mount(Followers, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();

    // Should display both follower identifiers
    expect(wrapper.text()).toContain('test@example.com');
    expect(wrapper.text()).toContain('calendar@remote.org');
  });

  it('should show loading state while fetching followers', () => {
    const feedStore = useFeedStore();
    feedStore.loading.followers = true;
    feedStore.followers = [];

    const wrapper = mount(Followers, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    // Should show loading message
    expect(wrapper.text()).toContain('Loading followers');
  });
});
