import { describe, it, expect } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import BulkOperationsMenu from '@/client/components/logged_in/calendar/BulkOperationsMenu.vue';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
];

const createWrapper = (props = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  return mountComponent(BulkOperationsMenu, router, {
    props: {
      selectedCount: 0,
      ...props,
    },
  });
};

describe('BulkOperationsMenu', () => {

  describe('visibility', () => {
    it('should be hidden when no events are selected', () => {
      const wrapper = createWrapper({ selectedCount: 0 });

      expect(wrapper.find('.bulk-operations-menu').exists()).toBe(false);
    });

    it('should be visible when events are selected', () => {
      const wrapper = createWrapper({ selectedCount: 2 });

      expect(wrapper.find('.bulk-operations-menu').classes()).not.toContain('hidden');
    });
  });

  describe('selection count display', () => {
    it('should display the correct selection count', () => {
      const wrapper = createWrapper({ selectedCount: 3 });

      expect(wrapper.text()).toContain('3');
    });

    it('should use singular form for single selection', () => {
      const wrapper = createWrapper({ selectedCount: 1 });

      const text = wrapper.text();
      expect(text).toContain('1');
      // Check for singular text (translated)
      expect(text).toContain('1 event selected');
    });

    it('should use plural form for multiple selections', () => {
      const wrapper = createWrapper({ selectedCount: 5 });

      const text = wrapper.text();
      expect(text).toContain('5');
      // Check for plural text (translated)
      expect(text).toContain('5 events selected');
    });
  });

  describe('bulk operations', () => {
    it('should emit assign-categories event when assign categories is clicked', async () => {
      const wrapper = createWrapper({ selectedCount: 2 });

      const assignButton = wrapper.find('[data-testid="assign-categories-btn"]');
      await assignButton.trigger('click');

      expect(wrapper.emitted('assign-categories')).toBeTruthy();
    });

    it('should emit deselect-all event when deselect all is clicked', async () => {
      const wrapper = createWrapper({ selectedCount: 3 });

      const deselectButton = wrapper.find('[data-testid="deselect-all-btn"]');
      await deselectButton.trigger('click');

      expect(wrapper.emitted('deselect-all')).toBeTruthy();
    });

    it('should show all available bulk operation buttons', () => {
      const wrapper = createWrapper({ selectedCount: 2 });

      expect(wrapper.find('[data-testid="assign-categories-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="deselect-all-btn"]').exists()).toBe(true);
    });
  });

  describe('accessibility', () => {
    it('should have proper ARIA attributes', () => {
      const wrapper = createWrapper({ selectedCount: 2 });

      const menu = wrapper.find('.bulk-operations-menu');
      expect(menu.attributes('role')).toBe('toolbar');
      expect(menu.attributes('aria-label')).toBe('Bulk Operations');
    });

    it('should announce selection count to screen readers', () => {
      const wrapper = createWrapper({ selectedCount: 2 });

      const announcement = wrapper.find('[aria-live="polite"]');
      expect(announcement.exists()).toBe(true);
    });
  });
});
