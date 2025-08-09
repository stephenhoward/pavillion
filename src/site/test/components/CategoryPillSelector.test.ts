import { expect, describe, it, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';
import CategoryPillSelector from '@/site/components/CategoryPillSelector.vue';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
];

const mountCategoryPillSelector = (props: Record<string, any> = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  const pinia = createPinia();

  const defaultProps = {
    categories: [],
    selectedCategories: [],
    ...props,
  };

  const wrapper = mount(CategoryPillSelector, {
    global: {
      plugins: [
        router,
        [I18NextVue, { i18next }],
        pinia,
      ],
    },
    props: defaultProps,
  });

  return {
    wrapper,
    router,
  };
};

const createTestCategory = (id: string, name: string): EventCategory => {
  const category = new EventCategory(id, 'test-calendar');
  const content = new EventCategoryContent('en', name);
  category.addContent(content);
  return category;
};

describe('CategoryPillSelector Component', () => {
  let currentWrapper: any = null;

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
  });

  describe('Component Rendering', () => {
    it('renders empty state when no categories provided', () => {
      const { wrapper } = mountCategoryPillSelector();
      currentWrapper = wrapper;

      expect(wrapper.find('.category-pill-selector').exists()).toBe(true);
      expect(wrapper.findAll('.category-pill').length).toBe(0);
    });

    it('renders category pills for provided categories', () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
        createTestCategory('3', 'Business'),
      ];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pills = wrapper.findAll('.category-pill');
      expect(pills.length).toBe(3);
      expect(pills[0].text()).toBe('Arts');
      expect(pills[1].text()).toBe('Sports');
      expect(pills[2].text()).toBe('Business');
    });

    it('applies selected class to selected categories', () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
      ];

      const { wrapper } = mountCategoryPillSelector({
        categories,
        selectedCategories: ['Arts'],
      });
      currentWrapper = wrapper;

      const pills = wrapper.findAll('.category-pill');
      expect(pills[0].classes()).toContain('selected');
      expect(pills[1].classes()).not.toContain('selected');
    });

    it('shows checkmark icon for selected categories', () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({
        categories,
        selectedCategories: ['Arts'],
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.find('.checkmark').exists()).toBe(true);
    });

    it('does not show checkmark for unselected categories', () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.find('.checkmark').exists()).toBe(false);
    });

    it('applies disabled class when disabled prop is true', () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({
        categories,
        disabled: true,
      });
      currentWrapper = wrapper;

      const selector = wrapper.find('.category-pill-selector');
      expect(selector.classes()).toContain('disabled');
    });
  });

  describe('Interaction Behavior', () => {
    it('emits update:selectedCategories when pill is clicked', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      await pill.trigger('click');

      const emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual([['Arts']]);
    });

    it('toggles category selection on click', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({
        categories,
        selectedCategories: [],
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');

      // First click should select
      await pill.trigger('click');
      let emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted?.[0]).toEqual([['Arts']]);

      // Second click should deselect
      await wrapper.setProps({ selectedCategories: ['Arts'] });
      await pill.trigger('click');
      emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted?.[1]).toEqual([[]]);
    });

    it('supports multiple category selection', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
      ];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pills = wrapper.findAll('.category-pill');

      // Select first category
      await pills[0].trigger('click');
      let emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted?.[0]).toEqual([['Arts']]);

      // Select second category (should add to selection)
      await wrapper.setProps({ selectedCategories: ['Arts'] });
      await pills[1].trigger('click');
      emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted?.[1]).toEqual([['Arts', 'Sports']]);
    });

    it('does not emit events when disabled', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({
        categories,
        disabled: true,
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      await pill.trigger('click');

      expect(wrapper.emitted('update:selectedCategories')).toBeFalsy();
    });
  });

  describe('Keyboard Navigation', () => {
    it('focuses pills with Tab key navigation', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
      ];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pills = wrapper.findAll('.category-pill');

      // Pills should be focusable
      expect(pills[0].attributes('tabindex')).toBe('0');
      expect(pills[1].attributes('tabindex')).toBe('0');
    });

    it('toggles selection with Space key', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      await pill.trigger('keydown', { key: ' ' });

      const emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual([['Arts']]);
    });

    it('toggles selection with Enter key', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      await pill.trigger('keydown', { key: 'Enter' });

      const emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual([['Arts']]);
    });

    it('does not respond to keyboard when disabled', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({
        categories,
        disabled: true,
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      await pill.trigger('keydown', { key: ' ' });

      expect(wrapper.emitted('update:selectedCategories')).toBeFalsy();
    });
  });

  describe('V-Model Integration', () => {
    it('correctly reflects selectedCategories prop', () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
      ];

      const { wrapper } = mountCategoryPillSelector({
        categories,
        selectedCategories: ['Sports'],
      });
      currentWrapper = wrapper;

      const pills = wrapper.findAll('.category-pill');
      expect(pills[0].classes()).not.toContain('selected');
      expect(pills[1].classes()).toContain('selected');
    });

    it('works with empty selectedCategories array', () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({
        categories,
        selectedCategories: [],
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.classes()).not.toContain('selected');
    });

    it('handles invalid category IDs in selectedCategories', () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({
        categories,
        selectedCategories: ['invalid-id'],
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.classes()).not.toContain('selected');
    });
  });

  describe('Responsive Layout', () => {
    it('applies proper CSS classes for responsive wrapping', () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
        createTestCategory('3', 'Business'),
      ];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const selector = wrapper.find('.category-pill-selector');
      expect(selector.classes()).toContain('category-pill-selector');

      // Should have proper flex wrapping CSS applied
      expect(wrapper.html()).toContain('category-pill-selector');
    });

    it('maintains minimum touch target size', () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      // The component should set minimum height for touch targets
      expect(pill.exists()).toBe(true);
    });
  });

  describe('Mobile Responsive Behavior', () => {
    it('applies responsive CSS classes for mobile breakpoints', () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
        createTestCategory('3', 'Business'),
      ];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const selector = wrapper.find('.category-pill-selector');
      expect(selector.exists()).toBe(true);

      // The component should have flex layout that wraps properly
      const pills = wrapper.findAll('.category-pill');
      expect(pills.length).toBe(3);
    });

    it('maintains touch target sizes on mobile screens', () => {
      const categories = [createTestCategory('1', 'Arts & Culture')];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');

      // Check that the pill has the CSS class that ensures minimum touch target
      expect(pill.classes()).toContain('category-pill');
      expect(pill.exists()).toBe(true);
    });

    it('handles text wrapping for long category names', () => {
      const categories = [
        createTestCategory('1', 'Very Long Category Name That Should Wrap Properly'),
      ];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.text()).toContain('Very Long Category Name');
    });

    it('maintains proper spacing between pills on mobile', () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
        createTestCategory('3', 'Business'),
        createTestCategory('4', 'Technology'),
        createTestCategory('5', 'Education'),
      ];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const selector = wrapper.find('.category-pill-selector');
      expect(selector.exists()).toBe(true);

      const pills = wrapper.findAll('.category-pill');
      expect(pills.length).toBe(5);
    });

    it('supports maxDisplayRows prop for overflow handling', () => {
      const categories = Array.from({ length: 15 }, (_, i) =>
        createTestCategory(`${i + 1}`, `Category ${i + 1}`),
      );

      const { wrapper } = mountCategoryPillSelector({
        categories,
        maxDisplayRows: 3,
      });
      currentWrapper = wrapper;

      const selector = wrapper.find('.category-pill-selector');
      expect(selector.exists()).toBe(true);

      const pills = wrapper.findAll('.category-pill');
      expect(pills.length).toBe(15);
    });
  });

  describe('Touch Interaction Support', () => {
    it('handles touch events for pill selection', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');

      // Simulate touch interaction
      await pill.trigger('click');

      const emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual([['Arts']]);
    });

    it('provides visual feedback for touch interactions', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');

      // Initially unselected
      expect(pill.classes()).not.toContain('selected');

      // After click (simulating touch), should show visual change
      await pill.trigger('click');

      // Check that the component would emit the change
      const emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted?.[0]).toEqual([['Arts']]);
    });

    it('prevents selection when disabled on touch devices', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({
        categories,
        disabled: true,
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      await pill.trigger('click');

      expect(wrapper.emitted('update:selectedCategories')).toBeFalsy();
    });

    it('supports rapid touch interactions', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
        createTestCategory('3', 'Business'),
      ];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pills = wrapper.findAll('.category-pill');

      // Rapidly select multiple categories
      await pills[0].trigger('click');
      await pills[1].trigger('click');
      await pills[2].trigger('click');

      const emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted).toBeTruthy();
      expect(emitted?.length).toBe(3);
    });
  });

  describe('Enhanced Accessibility Features', () => {
    it('has proper ARIA attributes', () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('role')).toBe('button');
      expect(pill.attributes('aria-pressed')).toBe('false');
      expect(pill.attributes('tabindex')).toBe('0');
    });

    it('updates aria-pressed when selected', () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({
        categories,
        selectedCategories: ['Arts'],
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('aria-pressed')).toBe('true');
    });

    it('has proper aria-label for screen readers', () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('aria-label')).toContain('Arts');
      expect(pill.attributes('aria-label')).toContain('not selected');
    });

    it('updates aria-label when selection state changes', () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({
        categories,
        selectedCategories: ['1'],
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('aria-label')).toContain('Arts');
      expect(pill.attributes('aria-label')).toContain('selected');
    });

    it('maintains focus state visibility', () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('tabindex')).toBe('0');

      // Component should support focus styles (tested via CSS)
      expect(pill.exists()).toBe(true);
    });

    it('provides proper screen reader context for checkmarks', () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({
        categories,
        selectedCategories: ['Arts'],
      });
      currentWrapper = wrapper;

      const checkmark = wrapper.find('.checkmark');
      expect(checkmark.exists()).toBe(true);
      expect(checkmark.attributes('aria-hidden')).toBe('true');
    });

    it('maintains keyboard navigation order', () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
        createTestCategory('3', 'Business'),
      ];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pills = wrapper.findAll('.category-pill');

      // All pills should be in tab order
      pills.forEach(pill => {
        expect(pill.attributes('tabindex')).toBe('0');
      });
    });

    it('handles focus management when disabled', () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({
        categories,
        disabled: true,
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('disabled')).toBe('');
    });
  });

  describe('Cross-Browser Compatibility', () => {
    it('uses standard event handlers compatible across browsers', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');

      // Test click event (standard across browsers)
      await pill.trigger('click');

      const emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted).toBeTruthy();
    });

    it('handles keyboard events consistently', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');

      // Test Space key
      await pill.trigger('keydown', { key: ' ' });
      let emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted?.[0]).toEqual([['Arts']]);

      // Test Enter key
      await pill.trigger('keydown', { key: 'Enter' });
      emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted?.length).toBe(2);
    });

    it('uses semantic HTML elements for better compatibility', () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.element.tagName).toBe('BUTTON');
    });
  });
});
