import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { mountComponent } from '@/client/test/lib/vue';
import CategorySelector from '@/client/components/logged_in/calendar/category-selector.vue';
import CategoryEditor from '@/client/components/logged_in/calendar-content/category-editor.vue';
import CategoryService from '@/client/service/category';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';

const routes: RouteRecordRaw[] = [
  { path: '/event', component: {}, name: 'event' },
];

/**
 * Helper to create a test category with translatable content
 */
function createTestCategory(id: string, name: string): EventCategory {
  const category = new EventCategory(id, 'calendar-123');
  category.addContent(EventCategoryContent.fromObject({
    language: 'en',
    name: name,
  }));
  return category;
}

const createWrapper = (props = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  return mountComponent(CategorySelector, router, {
    props: {
      calendarId: 'calendar-123',
      selectedCategories: [],
      ...props,
    },
  });
};

describe('CategorySelector', () => {
  let wrapper: any;
  let mockLoadCategories: any;

  const testCategories = [
    createTestCategory('cat-1', 'Music'),
    createTestCategory('cat-2', 'Sports'),
    createTestCategory('cat-3', 'Arts'),
  ];

  beforeEach(() => {
    mockLoadCategories = vi.fn().mockResolvedValue(testCategories);
    vi.spyOn(CategoryService.prototype, 'loadCategories').mockImplementation(mockLoadCategories);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  describe('Initialization with string IDs', () => {
    it('should accept selectedCategories as an array of string IDs', async () => {
      wrapper = createWrapper({
        selectedCategories: ['cat-1', 'cat-3'],
      });

      await nextTick();
      await nextTick();

      // The toggle chips for cat-1 and cat-3 should be selected
      const chips = wrapper.findAll('.toggle-chip');
      expect(chips.length).toBe(3);

      // cat-1 (Music) should be selected
      const musicChip = chips.find((c: any) => c.text() === 'Music');
      expect(musicChip?.attributes('aria-checked')).toBe('true');

      // cat-2 (Sports) should NOT be selected
      const sportsChip = chips.find((c: any) => c.text() === 'Sports');
      expect(sportsChip?.attributes('aria-checked')).toBe('false');

      // cat-3 (Arts) should be selected
      const artsChip = chips.find((c: any) => c.text() === 'Arts');
      expect(artsChip?.attributes('aria-checked')).toBe('true');
    });
  });

  describe('Late prop arrival (duplicate mode race condition)', () => {
    it('should show pre-selected chips when selectedCategories prop arrives after mount', async () => {
      // Simulate duplicate mode: component mounts with empty selection, then parent
      // finishes loading the source event and updates the prop
      wrapper = createWrapper({
        selectedCategories: [],
      });

      // Wait for initial mount and category loading to complete
      await nextTick();
      await nextTick();

      // Verify initially no chips are selected
      let chips = wrapper.findAll('.toggle-chip');
      expect(chips.length).toBe(3);
      for (const chip of chips) {
        expect(chip.attributes('aria-checked')).toBe('false');
      }

      // Simulate parent updating the prop after async event loading (duplicate mode)
      await wrapper.setProps({ selectedCategories: ['cat-1', 'cat-3'] });
      await nextTick();

      // cat-1 and cat-3 should now be selected
      chips = wrapper.findAll('.toggle-chip');
      const musicChip = chips.find((c: any) => c.text() === 'Music');
      expect(musicChip?.attributes('aria-checked')).toBe('true');

      const sportsChip = chips.find((c: any) => c.text() === 'Sports');
      expect(sportsChip?.attributes('aria-checked')).toBe('false');

      const artsChip = chips.find((c: any) => c.text() === 'Arts');
      expect(artsChip?.attributes('aria-checked')).toBe('true');
    });
  });

  describe('Toggle emits string IDs', () => {
    it('should emit categoriesChanged with an array of string IDs when a category is toggled on', async () => {
      wrapper = createWrapper({
        selectedCategories: [],
      });

      await nextTick();
      await nextTick();

      // Click on the Music chip to toggle it on
      const chips = wrapper.findAll('.toggle-chip');
      const musicChip = chips.find((c: any) => c.text() === 'Music');
      await musicChip?.trigger('click');

      const emitted = wrapper.emitted('categoriesChanged');
      expect(emitted).toBeTruthy();
      expect(emitted[0][0]).toEqual(['cat-1']);

      // Every element should be a string, not an object
      for (const id of emitted[0][0]) {
        expect(typeof id).toBe('string');
      }
    });

    it('should emit categoriesChanged with string IDs when toggling off a selected category', async () => {
      wrapper = createWrapper({
        selectedCategories: ['cat-1', 'cat-2'],
      });

      await nextTick();
      await nextTick();

      // Click on Music chip to toggle it off
      const chips = wrapper.findAll('.toggle-chip');
      const musicChip = chips.find((c: any) => c.text() === 'Music');
      await musicChip?.trigger('click');

      const emitted = wrapper.emitted('categoriesChanged');
      expect(emitted).toBeTruthy();
      // Should now only contain cat-2
      expect(emitted[0][0]).toEqual(['cat-2']);

      for (const id of emitted[0][0]) {
        expect(typeof id).toBe('string');
      }
    });

    it('should emit an empty array when all categories are toggled off', async () => {
      wrapper = createWrapper({
        selectedCategories: ['cat-1'],
      });

      await nextTick();
      await nextTick();

      // Toggle off cat-1
      const chips = wrapper.findAll('.toggle-chip');
      const musicChip = chips.find((c: any) => c.text() === 'Music');
      await musicChip?.trigger('click');

      const emitted = wrapper.emitted('categoriesChanged');
      expect(emitted).toBeTruthy();
      expect(emitted[0][0]).toEqual([]);
    });
  });

  describe('Backward compatibility with object IDs', () => {
    it('should also accept selectedCategories as an array of objects with .id', async () => {
      wrapper = createWrapper({
        selectedCategories: [{ id: 'cat-2' }],
      });

      await nextTick();
      await nextTick();

      const chips = wrapper.findAll('.toggle-chip');
      const sportsChip = chips.find((c: any) => c.text() === 'Sports');
      expect(sportsChip?.attributes('aria-checked')).toBe('true');

      // Others should not be selected
      const musicChip = chips.find((c: any) => c.text() === 'Music');
      expect(musicChip?.attributes('aria-checked')).toBe('false');
    });
  });

  describe('Inline category creation', () => {
    it('should render the "+ New category" button below the chips when categories exist', async () => {
      wrapper = createWrapper({
        selectedCategories: [],
      });

      await nextTick();
      await nextTick();

      const button = wrapper.find('[data-test="add-category-button"]');
      expect(button.exists()).toBe(true);
      expect(button.attributes('type')).toBe('button');
    });

    it('should render the "+ New category" button alongside the empty-state message when no categories exist', async () => {
      // Override the mock to return an empty list
      mockLoadCategories.mockResolvedValue([]);

      wrapper = createWrapper({
        selectedCategories: [],
      });

      await nextTick();
      await nextTick();

      // The no-categories empty-state message is still present
      expect(wrapper.find('.no-categories').exists()).toBe(true);

      // And the button is present as well
      const button = wrapper.find('[data-test="add-category-button"]');
      expect(button.exists()).toBe(true);
    });

    it('should mount the CategoryEditor modal when the button is clicked', async () => {
      wrapper = createWrapper({
        selectedCategories: [],
      });

      await nextTick();
      await nextTick();

      // Modal should not be mounted initially
      expect(wrapper.findComponent(CategoryEditor).exists()).toBe(false);

      const button = wrapper.find('[data-test="add-category-button"]');
      await button.trigger('click');
      await nextTick();

      // Modal should now be mounted
      const modal = wrapper.findComponent(CategoryEditor);
      expect(modal.exists()).toBe(true);

      // The category passed to the modal should have calendarId set and be scoped for creation (no id)
      const categoryProp = modal.props('category') as EventCategory;
      expect(categoryProp).toBeTruthy();
      expect(categoryProp.calendarId).toBe('calendar-123');
      expect(categoryProp.id).toBeFalsy();
      // And it should have default 'en' content registered
      expect(categoryProp.getLanguages()).toContain('en');
    });

    it('should append the saved category chip to the DOM, auto-select it, and emit categoriesChanged', async () => {
      wrapper = createWrapper({
        selectedCategories: ['cat-1'],
      });

      await nextTick();
      await nextTick();

      // Open the modal
      const button = wrapper.find('[data-test="add-category-button"]');
      await button.trigger('click');
      await nextTick();

      // Find the modal and simulate a successful save by emitting 'saved'
      const modal = wrapper.findComponent(CategoryEditor);
      expect(modal.exists()).toBe(true);

      const newCategory = createTestCategory('cat-new', 'Festivals');

      // Step 1: Emit 'saved' first. The design contract requires the chip append,
      // auto-select, and categoriesChanged emit to happen as a result of 'saved' —
      // not 'close'. Assert the DOM and emission reflect that before the modal closes.
      modal.vm.$emit('saved', newCategory);
      await nextTick();

      // New chip rendered in the DOM
      let chips = wrapper.findAll('.toggle-chip');
      let festivalsChip = chips.find((c: any) => c.text() === 'Festivals');
      expect(festivalsChip).toBeTruthy();

      // Auto-selected
      expect(festivalsChip?.attributes('aria-checked')).toBe('true');

      // categoriesChanged emitted with both existing and new id
      const emittedAfterSave = wrapper.emitted('categoriesChanged');
      expect(emittedAfterSave).toBeTruthy();
      const lastEmitAfterSave = emittedAfterSave[emittedAfterSave.length - 1][0];
      expect(lastEmitAfterSave).toContain('cat-new');
      expect(lastEmitAfterSave).toContain('cat-1');

      // Modal is still mounted at this point (close hasn't been emitted yet)
      expect(wrapper.findComponent(CategoryEditor).exists()).toBe(true);

      // Step 2: Emit 'close'. Only now should the modal unmount.
      modal.vm.$emit('close');
      await nextTick();

      expect(wrapper.findComponent(CategoryEditor).exists()).toBe(false);

      // Chip and selection persist after close
      chips = wrapper.findAll('.toggle-chip');
      festivalsChip = chips.find((c: any) => c.text() === 'Festivals');
      expect(festivalsChip).toBeTruthy();
      expect(festivalsChip?.attributes('aria-checked')).toBe('true');
    });

    it('should hide the "+ New category" button during loading', async () => {
      // Make loadCategories return a never-resolving promise so the component
      // stays in its loading state.
      let resolveLoad: (categories: EventCategory[]) => void = () => {};
      mockLoadCategories.mockImplementation(
        () => new Promise<EventCategory[]>((resolve) => {
          resolveLoad = resolve;
        }),
      );

      wrapper = createWrapper({
        selectedCategories: [],
      });

      // Let onMounted kick off loadCategories but do NOT resolve yet.
      await nextTick();

      // The loading indicator should be visible
      expect(wrapper.find('.loading').exists()).toBe(true);

      // And the add-category button should NOT be in the DOM
      expect(wrapper.find('[data-test="add-category-button"]').exists()).toBe(false);

      // Clean up the pending promise so the test doesn't leak
      resolveLoad([]);
      await nextTick();
      await nextTick();
    });

    it('should hide the "+ New category" button during the error state', async () => {
      // Make loadCategories reject so the component transitions to the error state.
      mockLoadCategories.mockRejectedValue(new Error('network failure'));

      // Silence the expected console.error from the catch block
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      wrapper = createWrapper({
        selectedCategories: [],
      });

      // Wait for the rejection to flow through
      await nextTick();
      await nextTick();
      await nextTick();

      // Error region is present
      expect(wrapper.find('.error').exists()).toBe(true);

      // Add-category button is NOT present
      expect(wrapper.find('[data-test="add-category-button"]').exists()).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should return focus to the "+ New category" button after the modal closes', async () => {
      wrapper = createWrapper(
        { selectedCategories: [] },
      );

      // Attach the wrapper's root to the document so document.activeElement
      // reflects real focus state in happy-dom.
      document.body.appendChild(wrapper.element);

      await nextTick();
      await nextTick();

      const buttonEl = wrapper.find('[data-test="add-category-button"]').element as HTMLButtonElement;
      expect(buttonEl).toBeTruthy();

      // Open the modal
      await wrapper.find('[data-test="add-category-button"]').trigger('click');
      await nextTick();

      const modal = wrapper.findComponent(CategoryEditor);
      expect(modal.exists()).toBe(true);

      // Close without saving — focus should return to the button
      modal.vm.$emit('close');
      await nextTick();
      await nextTick();

      expect(document.activeElement).toBe(buttonEl);
    });

    it('should close the modal without emitting categoriesChanged when closed without saving', async () => {
      wrapper = createWrapper({
        selectedCategories: [],
      });

      await nextTick();
      await nextTick();

      // Open the modal
      const button = wrapper.find('[data-test="add-category-button"]');
      await button.trigger('click');
      await nextTick();

      const modal = wrapper.findComponent(CategoryEditor);
      expect(modal.exists()).toBe(true);

      // Close without saving
      modal.vm.$emit('close');
      await nextTick();

      // Modal unmounted
      expect(wrapper.findComponent(CategoryEditor).exists()).toBe(false);

      // No categoriesChanged emitted
      const emitted = wrapper.emitted('categoriesChanged');
      expect(emitted).toBeFalsy();
    });
  });
});
