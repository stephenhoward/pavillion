/**
 * App shell rail mode.
 *
 * These tests cover what script decides: the app-shell--rail class comes from
 * route meta alone, never from the viewport, and the sidebar links keep their
 * accessible names. happy-dom applies no SCSS, so the rail's visual effect
 * (pav-media(md) gating, rail width, sr-only labels) is verified by the
 * settings-navigation e2e spec, not here; do not add CSS assertions to this file.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { Calendar, Inbox, Settings } from 'lucide-vue-next';
import { mountComponent } from '@/client/test/lib/vue';
import { installMatchMedia, type FakeMatchMedia } from '@/client/test/lib/match-media';
import { resetShellLayoutForTesting } from '@/client/composables/useShellLayout';
import AppShell from '@/client/components/shell/app-shell.vue';
import type { NavigationItem } from '@/client/components/shell/types';

const Empty = { template: '<div />' };

const createRouterForTest = (): Router => createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/calendar', component: Empty },
    { path: '/inbox', component: Empty },
    {
      path: '/settings',
      component: { template: '<RouterView />' },
      meta: { shellRail: true },
      children: [
        { path: '', component: Empty },
        { path: 'account/profile', component: Empty },
      ],
    },
    { path: '/elsewhere', component: Empty, meta: { shellRail: true } },
  ],
});

const navigationItems: NavigationItem[] = [
  { id: 'calendar', label: 'Calendars', icon: Calendar, to: '/calendar' },
  { id: 'inbox', label: 'Inbox', icon: Inbox, to: '/inbox', badge: 3, badgeLabel: '3 unread notifications' },
  { id: 'settings', label: 'Settings', icon: Settings, to: '/settings' },
];

const mountAt = async (path: string) => {
  const router = createRouterForTest();
  await router.push(path);
  await router.isReady();
  const wrapper = mountComponent(AppShell, router, { props: { navigationItems } });
  return { wrapper, router };
};

describe('app shell rail mode', () => {
  let matchMedia: FakeMatchMedia | undefined;

  /** Answers every media query as wide (md+) or narrow. */
  const stubViewport = (wide: boolean) => {
    resetShellLayoutForTesting();
    matchMedia = installMatchMedia(wide);
  };

  afterEach(() => {
    matchMedia?.restore();
    matchMedia = undefined;
    resetShellLayoutForTesting();
  });

  it('does not set the rail class on a route without shellRail meta', async () => {
    const { wrapper } = await mountAt('/calendar');

    expect(wrapper.classes()).not.toContain('app-shell--rail');
  });

  it('sets the rail class when an ancestor record carries shellRail meta', async () => {
    const { wrapper } = await mountAt('/settings/account/profile');

    expect(wrapper.classes()).toContain('app-shell--rail');
  });

  it('sets the rail class from meta, not from the path', async () => {
    const { wrapper } = await mountAt('/elsewhere');

    expect(wrapper.classes()).toContain('app-shell--rail');
  });

  it('removes the rail class after navigating to a route without the meta', async () => {
    const { wrapper, router } = await mountAt('/settings');
    expect(wrapper.classes()).toContain('app-shell--rail');

    await router.push('/calendar');
    await wrapper.vm.$nextTick();

    expect(wrapper.classes()).not.toContain('app-shell--rail');
  });

  it('sets the rail class on a phone-width viewport', async () => {
    stubViewport(false);

    const { wrapper } = await mountAt('/settings');

    expect(wrapper.classes()).toContain('app-shell--rail');
  });

  it('leaves the rail class to route meta on a wide viewport', async () => {
    stubViewport(true);

    const { wrapper: railWrapper } = await mountAt('/settings');
    const { wrapper: plainWrapper } = await mountAt('/calendar');

    expect(railWrapper.classes()).toContain('app-shell--rail');
    expect(plainWrapper.classes()).not.toContain('app-shell--rail');
  });

  it('labels the skip link from the system translations', async () => {
    const { wrapper } = await mountAt('/calendar');

    expect(wrapper.find('.app-shell__skip-link').text()).toBe('Skip to main content');
  });

  it('keeps each sidebar link named by its label, with the badge count in the name', async () => {
    const { wrapper } = await mountAt('/settings');

    const links = wrapper.findAll('.sidebar a');
    expect(links).toHaveLength(navigationItems.length);

    navigationItems.forEach((item, index) => {
      expect(links[index].text()).toContain(item.label);
    });

    const inboxLink = links[1];
    expect(inboxLink.text()).toContain('Inbox 3 unread notifications');
    expect(inboxLink.find('.shell-nav-item__badge').attributes('aria-hidden')).toBe('true');
    expect(inboxLink.find('.shell-nav-item__badge').attributes('aria-label')).toBeUndefined();
  });

  it('gives sidebar links no title and hides their icons from assistive technology', async () => {
    const { wrapper } = await mountAt('/settings');

    for (const link of wrapper.findAll('.sidebar a')) {
      expect(link.attributes('title')).toBeUndefined();
      expect(link.find('.shell-nav-item__icon').attributes('aria-hidden')).toBe('true');
    }
  });
});
