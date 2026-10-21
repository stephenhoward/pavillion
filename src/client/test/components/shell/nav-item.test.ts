import { describe, it, expect } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { Inbox, Settings } from 'lucide-vue-next';
import { mountComponent } from '@/client/test/lib/vue';
import NavItem from '@/client/components/shell/nav-item.vue';
import SettingsFilled from '@/client/components/shell/icons/settings-filled.vue';
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

  it('marks an active item as the current page', () => {
    const wrapper = mountItem('list', { isActive: true });

    expect(wrapper.classes()).toContain('shell-nav-item--active');
    expect(wrapper.attributes('aria-current')).toBe('page');
  });

  /* The rail is the sidebar variant under a CSS mode, so 'sidebar' covers it */
  describe.each<NavItemVariant>(['sidebar', 'bottom', 'list'])('current-item icon in the %s variant', (variant) => {
    it('draws the filled icon on the current item', () => {
      const wrapper = mountItem(variant, { isActive: true });

      expect(wrapper.findComponent(SettingsFilled).exists()).toBe(true);
      expect(wrapper.findComponent(Settings).exists()).toBe(false);
      expect(wrapper.findAll('.shell-nav-item__icon')).toHaveLength(1);
    });

    it('draws the outline icon on any other item', () => {
      const wrapper = mountItem(variant);

      expect(wrapper.findComponent(Settings).exists()).toBe(true);
      expect(wrapper.findComponent(SettingsFilled).exists()).toBe(false);
    });

    it('keeps the name, the hidden icon and aria-current whichever icon it draws', () => {
      const current = mountItem(variant, { isActive: true });
      const other = mountItem(variant);

      expect(current.text()).toBe('Settings');
      expect(other.text()).toBe('Settings');
      expect(current.find('.shell-nav-item__icon').attributes('aria-hidden')).toBe('true');
      expect(other.find('.shell-nav-item__icon').attributes('aria-hidden')).toBe('true');
      expect(current.attributes('aria-current')).toBe('page');
      expect(other.attributes('aria-current')).toBeUndefined();
    });
  });

  it('falls back to the outline icon on a current item with no filled variant', () => {
    const wrapper = mountItem('sidebar', { icon: Inbox, isActive: true });

    expect(wrapper.findComponent(Inbox).exists()).toBe(true);
    expect(wrapper.findAll('.shell-nav-item__icon')).toHaveLength(1);
  });

  it('omits aria-current by default', () => {
    const wrapper = mountItem('sidebar');

    expect(wrapper.attributes('aria-current')).toBeUndefined();
  });
});
