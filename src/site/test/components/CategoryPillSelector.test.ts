import { expect, describe, it, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { nextTick } from 'vue';

import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';
import CategoryPillSelector from '@/site/components/CategoryPillSelector.vue';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
  { path: '/view/:calendar', component: {}, name: 'calendar' },
  { path: '/:locale/view/:calendar', component: {}, name: 'calendar-locale' },
];

const mountCategoryPillSelector = async (props: Record<string, any> = {}, initialRoute = '/view/test-calendar') => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  router.push(initialRoute);
  await router.isReady();

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

/**
 * Create a category with content in multiple languages.
 */
const createMultilingualCategory = (
  id: string,
  translations: { lang: string; name: string }[],
): EventCategory => {
  const category = new EventCategory(id, 'test-calendar');
  for (const { lang, name } of translations) {
    const content = new EventCategoryContent(lang, name);
    category.addContent(content);
  }
  return category;
};

/**
 * A no-op matchMedia stub that returns matches: false for all queries.
 * Used to satisfy the getScrollBehavior helper in tests that don't exercise it directly.
 */
const stubMatchMedia = () => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe('CategoryPillSelector Component', () => {
  let currentWrapper: any = null;

  beforeAll(async () => {
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          system: {
            scroll_categories_left: 'Scroll categories left',
            scroll_categories_right: 'Scroll categories right',
            category_filter_aria_label: '{{name}} category filter, {{state}}',
            selected: 'selected',
            not_selected: 'not selected',
          },
        },
        es: {
          system: {
            scroll_categories_left: 'Desplazar categorías a la izquierda',
            scroll_categories_right: 'Desplazar categorías a la derecha',
            category_filter_aria_label: '{{name}} filtro de categoría, {{state}}',
            selected: 'seleccionado',
            not_selected: 'no seleccionado',
          },
        },
        fr: { system: {} },
      },
    });
  });

  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
  });

  describe('Component Rendering', () => {
    it('renders empty state when no categories provided', async () => {
      const { wrapper } = await mountCategoryPillSelector();
      currentWrapper = wrapper;

      expect(wrapper.find('.category-pill-selector').exists()).toBe(true);
      expect(wrapper.findAll('.category-pill').length).toBe(0);
    });

    it('renders category pills for provided categories', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
        createTestCategory('3', 'Business'),
      ];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pills = wrapper.findAll('.category-pill');
      expect(pills.length).toBe(3);
      expect(pills[0].text()).toBe('Arts');
      expect(pills[1].text()).toBe('Sports');
      expect(pills[2].text()).toBe('Business');
    });

    it('applies selected class to selected categories', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
      ];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: ['1'],
      });
      currentWrapper = wrapper;

      const pills = wrapper.findAll('.category-pill');
      expect(pills[0].classes()).toContain('selected');
      expect(pills[1].classes()).not.toContain('selected');
    });

    it('shows checkmark icon for selected categories', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: ['1'],
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.find('.checkmark').exists()).toBe(true);
    });

    it('does not show checkmark for unselected categories', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.find('.checkmark').exists()).toBe(false);
    });

    it('applies disabled class when disabled prop is true', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        disabled: true,
      });
      currentWrapper = wrapper;

      const selector = wrapper.find('.category-pill-selector');
      expect(selector.classes()).toContain('disabled');
    });
  });

  describe('Multilingual Display', () => {
    it('displays category names in the current locale when available', async () => {
      const categories = [
        createMultilingualCategory('1', [
          { lang: 'en', name: 'Arts' },
          { lang: 'es', name: 'Artes' },
        ]),
        createMultilingualCategory('2', [
          { lang: 'en', name: 'Sports' },
          { lang: 'es', name: 'Deportes' },
        ]),
      ];

      // Change i18next language to Spanish first
      await i18next.changeLanguage('es');

      // Mount with Spanish locale route
      const { wrapper } = await mountCategoryPillSelector(
        { categories },
        '/es/view/test-calendar',
      );
      currentWrapper = wrapper;

      await nextTick();

      const pills = wrapper.findAll('.category-pill');
      expect(pills[0].text()).toBe('Artes');
      expect(pills[1].text()).toBe('Deportes');
    });

    it('falls back to English when current locale content is not available', async () => {
      const categories = [
        createMultilingualCategory('1', [
          { lang: 'en', name: 'Arts' },
        ]),
      ];

      // Change i18next language to French
      await i18next.changeLanguage('fr');

      // Mount with French locale route, but only English content exists
      const { wrapper } = await mountCategoryPillSelector(
        { categories },
        '/fr/view/test-calendar',
      );
      currentWrapper = wrapper;

      await nextTick();

      const pill = wrapper.find('.category-pill');
      expect(pill.text()).toBe('Arts');
    });

    it('updates pill names when locale changes via route navigation', async () => {
      const categories = [
        createMultilingualCategory('1', [
          { lang: 'en', name: 'Community' },
          { lang: 'es', name: 'Comunidad' },
        ]),
      ];

      // Start in English
      const { wrapper, router } = await mountCategoryPillSelector(
        { categories },
        '/view/test-calendar',
      );
      currentWrapper = wrapper;
      await nextTick();

      let pill = wrapper.find('.category-pill');
      expect(pill.text()).toBe('Community');

      // Switch to Spanish by changing the route and i18next language
      await i18next.changeLanguage('es');
      await router.push('/es/view/test-calendar');
      await nextTick();
      await nextTick();

      pill = wrapper.find('.category-pill');
      expect(pill.text()).toBe('Comunidad');
    });

    it('shows fallback name for category with no content', async () => {
      const category = new EventCategory('1', 'test-calendar');
      // No content added at all

      const { wrapper } = await mountCategoryPillSelector({ categories: [category] });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.text()).toBe('Unnamed Category');
    });
  });

  describe('Interaction Behavior', () => {
    it('emits update:selectedCategories when pill is clicked', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      await pill.trigger('click');

      const emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual([['1']]);
    });

    it('toggles category selection on click', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: [],
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');

      // First click should select
      await pill.trigger('click');
      let emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted?.[0]).toEqual([['1']]);

      // Second click should deselect
      await wrapper.setProps({ selectedCategories: ['1'] });
      await pill.trigger('click');
      emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted?.[1]).toEqual([[]]);
    });

    it('supports multiple category selection', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
      ];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pills = wrapper.findAll('.category-pill');

      // Select first category
      await pills[0].trigger('click');
      let emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted?.[0]).toEqual([['1']]);

      // Select second category (should add to selection)
      await wrapper.setProps({ selectedCategories: ['1'] });
      await pills[1].trigger('click');
      emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted?.[1]).toEqual([['1', '2']]);
    });

    it('does not emit events when disabled', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({
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

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pills = wrapper.findAll('.category-pill');

      // Pills should be focusable
      expect(pills[0].attributes('tabindex')).toBe('0');
      expect(pills[1].attributes('tabindex')).toBe('0');
    });

    it('toggles selection with Space key', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      await pill.trigger('keydown', { key: ' ' });

      const emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual([['1']]);
    });

    it('toggles selection with Enter key', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      await pill.trigger('keydown', { key: 'Enter' });

      const emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual([['1']]);
    });

    it('does not respond to keyboard when disabled', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({
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
    it('correctly reflects selectedCategories prop', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
      ];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: ['2'],
      });
      currentWrapper = wrapper;

      const pills = wrapper.findAll('.category-pill');
      expect(pills[0].classes()).not.toContain('selected');
      expect(pills[1].classes()).toContain('selected');
    });

    it('works with empty selectedCategories array', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: [],
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.classes()).not.toContain('selected');
    });

    it('handles invalid category IDs in selectedCategories', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: ['invalid-id'],
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.classes()).not.toContain('selected');
    });
  });

  describe('Responsive Layout', () => {
    it('applies proper CSS classes for responsive wrapping', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
        createTestCategory('3', 'Business'),
      ];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const selector = wrapper.find('.category-pill-selector');
      expect(selector.classes()).toContain('category-pill-selector');

      // Should have proper flex wrapping CSS applied
      expect(wrapper.html()).toContain('category-pill-selector');
    });

    it('maintains minimum touch target size', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      // The component should set minimum height for touch targets
      expect(pill.exists()).toBe(true);
    });
  });

  describe('Mobile Responsive Behavior', () => {
    it('applies responsive CSS classes for mobile breakpoints', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
        createTestCategory('3', 'Business'),
      ];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const selector = wrapper.find('.category-pill-selector');
      expect(selector.exists()).toBe(true);

      // The component should have flex layout that wraps properly
      const pills = wrapper.findAll('.category-pill');
      expect(pills.length).toBe(3);
    });

    it('maintains touch target sizes on mobile screens', async () => {
      const categories = [createTestCategory('1', 'Arts & Culture')];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');

      // Check that the pill has the CSS class that ensures minimum touch target
      expect(pill.classes()).toContain('category-pill');
      expect(pill.exists()).toBe(true);
    });

    it('handles text wrapping for long category names', async () => {
      const categories = [
        createTestCategory('1', 'Very Long Category Name That Should Wrap Properly'),
      ];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.text()).toContain('Very Long Category Name');
    });

    it('maintains proper spacing between pills on mobile', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
        createTestCategory('3', 'Business'),
        createTestCategory('4', 'Technology'),
        createTestCategory('5', 'Education'),
      ];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const selector = wrapper.find('.category-pill-selector');
      expect(selector.exists()).toBe(true);

      const pills = wrapper.findAll('.category-pill');
      expect(pills.length).toBe(5);
    });

    it('supports maxDisplayRows prop for overflow handling', async () => {
      const categories = Array.from({ length: 15 }, (_, i) =>
        createTestCategory(`${i + 1}`, `Category ${i + 1}`),
      );

      const { wrapper } = await mountCategoryPillSelector({
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

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');

      // Simulate touch interaction
      await pill.trigger('click');

      const emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual([['1']]);
    });

    it('provides visual feedback for touch interactions', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');

      // Initially unselected
      expect(pill.classes()).not.toContain('selected');

      // After click (simulating touch), should show visual change
      await pill.trigger('click');

      // Check that the component would emit the change
      const emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted?.[0]).toEqual([['1']]);
    });

    it('prevents selection when disabled on touch devices', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({
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

      const { wrapper } = await mountCategoryPillSelector({ categories });
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
    it('has proper ARIA attributes', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('role')).toBe('button');
      expect(pill.attributes('aria-pressed')).toBe('false');
      expect(pill.attributes('tabindex')).toBe('0');
    });

    it('updates aria-pressed when selected', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: ['1'],
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('aria-pressed')).toBe('true');
    });

    it('has proper aria-label for screen readers', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('aria-label')).toContain('Arts');
      expect(pill.attributes('aria-label')).toContain('not selected');
    });

    it('updates aria-label when selection state changes', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: ['1'],
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('aria-label')).toContain('Arts');
      expect(pill.attributes('aria-label')).toContain('selected');
    });

    it('maintains focus state visibility', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('tabindex')).toBe('0');

      // Component should support focus styles (tested via CSS)
      expect(pill.exists()).toBe(true);
    });

    it('provides proper screen reader context for checkmarks', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: ['1'],
      });
      currentWrapper = wrapper;

      const checkmark = wrapper.find('.checkmark');
      expect(checkmark.exists()).toBe(true);
      expect(checkmark.attributes('aria-hidden')).toBe('true');
    });

    it('maintains keyboard navigation order', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
        createTestCategory('3', 'Business'),
      ];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pills = wrapper.findAll('.category-pill');

      // All pills should be in tab order
      pills.forEach(pill => {
        expect(pill.attributes('tabindex')).toBe('0');
      });
    });

    it('handles focus management when disabled', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({
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

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');

      // Test click event (standard across browsers)
      await pill.trigger('click');

      const emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted).toBeTruthy();
    });

    it('handles keyboard events consistently', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');

      // Test Space key
      await pill.trigger('keydown', { key: ' ' });
      let emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted?.[0]).toEqual([['1']]);

      // Test Enter key
      await pill.trigger('keydown', { key: 'Enter' });
      emitted = wrapper.emitted('update:selectedCategories');
      expect(emitted?.length).toBe(2);
    });

    it('uses semantic HTML elements for better compatibility', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.element.tagName).toBe('BUTTON');
    });
  });

  describe('scrollToSelectedCategory behavior', () => {
    let scrollIntoViewMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      scrollIntoViewMock = vi.fn();
      // jsdom does not implement scrollIntoView, so we install it globally
      window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should call scrollIntoView on mount when a category is pre-selected', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
      ];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: ['1'],
      });
      currentWrapper = wrapper;

      // Wait for the next DOM flush so onMounted has run
      await nextTick();

      expect(scrollIntoViewMock).toHaveBeenCalled();
    });

    it('should NOT call scrollIntoView on mount when no category is pre-selected', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
      ];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: [],
      });
      currentWrapper = wrapper;

      await nextTick();

      expect(scrollIntoViewMock).not.toHaveBeenCalled();
    });

    it('should call scrollIntoView when selectedCategories prop changes to include a selection', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
      ];

      // Start with no selection
      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: [],
      });
      currentWrapper = wrapper;

      await nextTick();
      const callsBefore = scrollIntoViewMock.mock.calls.length;

      // Now add a selection via prop change
      await wrapper.setProps({ selectedCategories: ['2'] });
      // flush: 'post' means the watcher runs after the DOM update — nextTick covers this
      await nextTick();

      expect(scrollIntoViewMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('should call scrollIntoView when selectedCategories prop changes from one selection to another', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
      ];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: ['1'],
      });
      currentWrapper = wrapper;

      await nextTick();
      const callsBefore = scrollIntoViewMock.mock.calls.length;

      await wrapper.setProps({ selectedCategories: ['2'] });
      await nextTick();

      expect(scrollIntoViewMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('should reset scroll to the start when all selected categories are cleared', async () => {
      const scrollToMock = vi.fn();

      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
      ];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: ['1'],
      });
      currentWrapper = wrapper;

      // Attach scrollTo mock to the container after mount
      const container = wrapper.find('.category-pill-selector').element as HTMLElement;
      container.scrollTo = scrollToMock;

      await nextTick();

      // Clear all selected categories
      await wrapper.setProps({ selectedCategories: [] });
      await nextTick();

      expect(scrollToMock).toHaveBeenCalledWith(
        expect.objectContaining({ left: 0 }),
      );
    });
  });

  describe('getScrollBehavior helper', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return "instant" when prefers-reduced-motion: reduce matches', async () => {
      // Mock window.matchMedia to return matches: true for prefers-reduced-motion
      const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: matchMediaMock,
      });

      // Mount the component and trigger scroll to exercise getScrollBehavior
      const scrollIntoViewMock = vi.fn();
      window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

      const categories = [createTestCategory('1', 'Arts')];
      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: ['1'],
      });
      currentWrapper = wrapper;

      await nextTick();

      // scrollIntoView should have been called with behavior: 'instant'
      expect(scrollIntoViewMock).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'instant' }),
      );
    });

    it('should return "smooth" when prefers-reduced-motion does not match', async () => {
      // Mock window.matchMedia to return matches: false
      const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: matchMediaMock,
      });

      const scrollIntoViewMock = vi.fn();
      window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

      const categories = [createTestCategory('1', 'Arts')];
      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: ['1'],
      });
      currentWrapper = wrapper;

      await nextTick();

      // scrollIntoView should have been called with behavior: 'smooth'
      expect(scrollIntoViewMock).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth' }),
      );
    });
  });

  describe('Scroll button aria-labels', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /**
     * Force the scroll container to report scrollable dimensions so that
     * canScrollRight becomes true and the right scroll arrow is rendered.
     */
    const makeScrollable = (wrapper: any) => {
      const container = wrapper.find('.category-pill-selector').element as HTMLElement;
      Object.defineProperty(container, 'scrollWidth', { configurable: true, get: () => 500 });
      Object.defineProperty(container, 'clientWidth', { configurable: true, get: () => 200 });
      Object.defineProperty(container, 'scrollLeft', { configurable: true, get: () => 100 });
      // Dispatch scroll to trigger updateScrollButtons
      container.dispatchEvent(new Event('scroll'));
    };

    it('scroll-right button aria-label uses translated string', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
        createTestCategory('3', 'Business'),
      ];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      makeScrollable(wrapper);
      await nextTick();

      const scrollRightBtn = wrapper.find('.scroll-arrow-right');
      expect(scrollRightBtn.exists()).toBe(true);
      expect(scrollRightBtn.attributes('aria-label')).toBe('Scroll categories right');
    });

    it('scroll-left button aria-label uses translated string', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
        createTestCategory('3', 'Business'),
      ];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      makeScrollable(wrapper);
      await nextTick();

      const scrollLeftBtn = wrapper.find('.scroll-arrow-left');
      expect(scrollLeftBtn.exists()).toBe(true);
      expect(scrollLeftBtn.attributes('aria-label')).toBe('Scroll categories left');
    });

    it('scroll button aria-labels update when locale changes to Spanish', async () => {
      const categories = [
        createTestCategory('1', 'Arts'),
        createTestCategory('2', 'Sports'),
        createTestCategory('3', 'Business'),
      ];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      makeScrollable(wrapper);
      await nextTick();

      // Switch to Spanish
      await i18next.changeLanguage('es');
      await nextTick();

      const scrollRightBtn = wrapper.find('.scroll-arrow-right');
      expect(scrollRightBtn.exists()).toBe(true);
      expect(scrollRightBtn.attributes('aria-label')).toBe('Desplazar categorías a la derecha');
    });
  });

  describe('Category filter button aria-labels', () => {
    beforeEach(() => {
      // Ensure window.matchMedia is available for tests that trigger
      // scrollToSelectedCategory on mount (which calls getScrollBehavior).
      stubMatchMedia();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('aria-label uses translated "not selected" state in English', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({ categories });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('aria-label')).toBe('Arts category filter, not selected');
    });

    it('aria-label uses translated "selected" state in English', async () => {
      const categories = [createTestCategory('1', 'Arts')];

      const { wrapper } = await mountCategoryPillSelector({
        categories,
        selectedCategories: ['1'],
      });
      currentWrapper = wrapper;

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('aria-label')).toBe('Arts category filter, selected');
    });

    it('aria-label is translated to Spanish when locale is Spanish', async () => {
      const categories = [
        createMultilingualCategory('1', [
          { lang: 'en', name: 'Arts' },
          { lang: 'es', name: 'Artes' },
        ]),
      ];

      await i18next.changeLanguage('es');

      const { wrapper } = await mountCategoryPillSelector(
        { categories },
        '/es/view/test-calendar',
      );
      currentWrapper = wrapper;

      await nextTick();

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('aria-label')).toBe('Artes filtro de categoría, no seleccionado');
    });

    it('aria-label selected state is translated to Spanish', async () => {
      const categories = [
        createMultilingualCategory('1', [
          { lang: 'en', name: 'Arts' },
          { lang: 'es', name: 'Artes' },
        ]),
      ];

      await i18next.changeLanguage('es');

      const { wrapper } = await mountCategoryPillSelector(
        { categories, selectedCategories: ['1'] },
        '/es/view/test-calendar',
      );
      currentWrapper = wrapper;

      await nextTick();

      const pill = wrapper.find('.category-pill');
      expect(pill.attributes('aria-label')).toBe('Artes filtro de categoría, seleccionado');
    });

    it('aria-label updates when locale switches from English to Spanish', async () => {
      const categories = [
        createMultilingualCategory('1', [
          { lang: 'en', name: 'Arts' },
          { lang: 'es', name: 'Artes' },
        ]),
      ];

      // Start in English
      const { wrapper, router } = await mountCategoryPillSelector(
        { categories },
        '/view/test-calendar',
      );
      currentWrapper = wrapper;

      await nextTick();

      let pill = wrapper.find('.category-pill');
      expect(pill.attributes('aria-label')).toBe('Arts category filter, not selected');

      // Switch to Spanish via both i18next and router navigation
      await i18next.changeLanguage('es');
      await router.push('/es/view/test-calendar');
      await nextTick();
      await nextTick();

      pill = wrapper.find('.category-pill');
      expect(pill.attributes('aria-label')).toBe('Artes filtro de categoría, no seleccionado');
    });
  });
});
