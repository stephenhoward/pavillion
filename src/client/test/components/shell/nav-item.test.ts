import { describe, it, expect } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { Settings } from 'lucide-vue-next';
import { mountComponent } from '@/client/test/lib/vue';
import NavItem from '@/client/components/shell/nav-item.vue';
import type { NavigationItemWithState, NavItemVariant } from '@/client/components/shell/types';

const createRouterForTest = (): Router => createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:pathMatch(.*)*', component: {} }],
});

const mountItem = (variant: NavItemVariant, overrides: Partial<NavigationItemWithState> = {}) => {
  const item: NavigationItemWithState = {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    to: '/settings',
    isActive: false,
    ...overrides,
  };
  return mountComponent(NavItem, createRouterForTest(), { props: { item, variant } });
};

describe('shell nav-item', () => {
  it('renders a hidden trailing chevron in the list variant', () => {
    const wrapper = mountItem('list');

    const chevron = wrapper.find('.shell-nav-item__chevron');
    expect(chevron.exists()).toBe(true);
    expect(chevron.attributes('aria-hidden')).toBe('true');
    expect(wrapper.classes()).toContain('shell-nav-item--list');
  });

  it.each<NavItemVariant>(['sidebar', 'bottom'])('renders no chevron in the %s variant', (variant) => {
    const wrapper = mountItem(variant);

    expect(wrapper.find('.shell-nav-item__chevron').exists()).toBe(false);
  });

  it('marks a danger item and an active item', () => {
    const wrapper = mountItem('list', { danger: true, isActive: true });

    expect(wrapper.classes()).toContain('shell-nav-item--danger');
    expect(wrapper.attributes('aria-current')).toBe('page');
  });

  it('omits the danger class and aria-current by default', () => {
    const wrapper = mountItem('sidebar');

    expect(wrapper.classes()).not.toContain('shell-nav-item--danger');
    expect(wrapper.attributes('aria-current')).toBeUndefined();
  });
});
