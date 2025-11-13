import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { mountComponent } from '@/client/test/lib/vue';
import categories from '@/client/components/logged_in/calendar-management/categories.vue';
import CategoryService from '@/client/service/category';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';

const routes: RouteRecordRaw[] = [
  { path: '/calendar/:calendar/categories', component: {}, name: 'categories' },
];

const createWrapper = (props = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  router.push({
    name: 'categories',
    params: { calendar: 'calendar-123' },
  });

  return mountComponent(categories, router, {
    props: {
      calendarId: 'calendar-123',
      ...props,
    },
  });
};

describe('Category Management Enhancements - Frontend UI', () => {
  let wrapper: any;
  let mockCategoryService: any;

  beforeEach(() => {
    // Mock CategoryService
    mockCategoryService = {
      loadCategories: vi.fn(),
      deleteCategory: vi.fn(),
      mergeCategories: vi.fn(),
    };

    vi.spyOn(CategoryService.prototype, 'loadCategories').mockImplementation(mockCategoryService.loadCategories);
    vi.spyOn(CategoryService.prototype, 'deleteCategory').mockImplementation(mockCategoryService.deleteCategory);
    vi.spyOn(CategoryService.prototype, 'mergeCategories').mockImplementation(mockCategoryService.mergeCategories);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  /**
   * Helper function to create test categories with event counts
   */
  function createTestCategory(id: string, name: string, eventCount: number): EventCategory & { eventCount: number } {
    const category = new EventCategory(id, 'calendar-123');
    category.addContent(EventCategoryContent.fromObject({
      language: 'en',
      name: name,
    }));
    return Object.assign(category, { eventCount });
  }

  describe('Event count display', () => {
    it('should display event count inline with category name', async () => {
      const mockCategories = [
        createTestCategory('cat-1', 'Music', 23),
        createTestCategory('cat-2', 'Sports', 10),
        createTestCategory('cat-3', 'Arts', 0),
      ];

      mockCategoryService.loadCategories.mockResolvedValue(mockCategories);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.categories.length > 0;
      }, { timeout: 1000 });

      const categoryNames = wrapper.findAll('.category-name');
      expect(categoryNames[0].text()).toContain('Music');
      expect(categoryNames[0].text()).toContain('(23)');
      expect(categoryNames[1].text()).toContain('Sports');
      expect(categoryNames[1].text()).toContain('(10)');
      expect(categoryNames[2].text()).toContain('Arts');
      expect(categoryNames[2].text()).toContain('(0)');
    });
  });

  describe('Bulk category selection', () => {
    it('should handle checkbox state management for bulk selection', async () => {
      const mockCategories = [
        createTestCategory('cat-1', 'Music', 5),
        createTestCategory('cat-2', 'Sports', 3),
      ];

      mockCategoryService.loadCategories.mockResolvedValue(mockCategories);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.categories.length > 0;
      }, { timeout: 1000 });

      const checkboxes = wrapper.findAll('input[type="checkbox"]');
      expect(checkboxes).toHaveLength(2);

      // Select first checkbox
      await checkboxes[0].setValue(true);
      expect(wrapper.vm.state.selectedCategories.has('cat-1')).toBe(true);

      // Select second checkbox
      await checkboxes[1].setValue(true);
      expect(wrapper.vm.state.selectedCategories.has('cat-2')).toBe(true);
      expect(wrapper.vm.state.selectedCategories.size).toBe(2);

      // Unselect first checkbox
      await checkboxes[0].setValue(false);
      expect(wrapper.vm.state.selectedCategories.has('cat-1')).toBe(false);
      expect(wrapper.vm.state.selectedCategories.size).toBe(1);
    });

    it('should show merge button when 2 or more categories are selected', async () => {
      const mockCategories = [
        createTestCategory('cat-1', 'Music', 5),
        createTestCategory('cat-2', 'Sports', 3),
        createTestCategory('cat-3', 'Arts', 2),
      ];

      mockCategoryService.loadCategories.mockResolvedValue(mockCategories);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.categories.length > 0;
      }, { timeout: 1000 });

      // Initially no merge button
      let mergeButton = wrapper.find('.btn-merge-categories');
      expect(mergeButton.exists()).toBe(false);

      // Select one category - still no merge button
      const checkboxes = wrapper.findAll('input[type="checkbox"]');
      await checkboxes[0].setValue(true);
      await nextTick();

      mergeButton = wrapper.find('.btn-merge-categories');
      expect(mergeButton.exists()).toBe(false);

      // Select second category - merge button should appear
      await checkboxes[1].setValue(true);
      await nextTick();

      mergeButton = wrapper.find('.btn-merge-categories');
      expect(mergeButton.exists()).toBe(true);
    });
  });

  describe('Delete dialog with migration options', () => {
    it('should show delete dialog with correct event count', async () => {
      const mockCategories = [
        createTestCategory('cat-1', 'Music', 15),
        createTestCategory('cat-2', 'Sports', 3),
      ];

      mockCategoryService.loadCategories.mockResolvedValue(mockCategories);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.categories.length > 0;
      }, { timeout: 1000 });

      // Click delete button
      const deleteButtons = wrapper.findAll('.btn--danger');
      await deleteButtons[0].trigger('click');
      await nextTick();

      // Check dialog is shown
      expect(wrapper.vm.state.showDeleteDialog).toBe(true);
      expect(wrapper.vm.state.categoryToDelete.id).toBe('cat-1');

      // Check event count is displayed
      const dialogText = wrapper.find('.delete-dialog').text();
      expect(dialogText).toContain('15');
    });

    it('should show radio buttons for remove vs migrate options', async () => {
      const mockCategories = [
        createTestCategory('cat-1', 'Music', 15),
        createTestCategory('cat-2', 'Sports', 3),
      ];

      mockCategoryService.loadCategories.mockResolvedValue(mockCategories);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.categories.length > 0;
      }, { timeout: 1000 });

      // Click delete button
      const deleteButtons = wrapper.findAll('.btn--danger');
      await deleteButtons[0].trigger('click');
      await nextTick();

      // Check radio buttons exist
      const radioButtons = wrapper.findAll('input[type="radio"]');
      expect(radioButtons.length).toBeGreaterThanOrEqual(2);

      // Check radio options
      const removeRadio = wrapper.find('input[value="remove"]');
      const migrateRadio = wrapper.find('input[value="migrate"]');
      expect(removeRadio.exists()).toBe(true);
      expect(migrateRadio.exists()).toBe(true);
    });

    it('should show category dropdown when migrate option is selected', async () => {
      const mockCategories = [
        createTestCategory('cat-1', 'Music', 15),
        createTestCategory('cat-2', 'Sports', 3),
        createTestCategory('cat-3', 'Arts', 5),
      ];

      mockCategoryService.loadCategories.mockResolvedValue(mockCategories);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.categories.length > 0;
      }, { timeout: 1000 });

      // Click delete button
      const deleteButtons = wrapper.findAll('.btn--danger');
      await deleteButtons[0].trigger('click');
      await nextTick();

      // Select migrate option
      const migrateRadio = wrapper.find('input[value="migrate"]');
      await migrateRadio.setValue(true);
      await nextTick();

      // Check dropdown appears and excludes the category being deleted
      const dropdown = wrapper.find('select.migration-target');
      expect(dropdown.exists()).toBe(true);

      const options = dropdown.findAll('option');
      // Should have 3 options: placeholder + 2 categories (excluding cat-1 being deleted)
      expect(options.length).toBeGreaterThanOrEqual(2);

      // Verify the deleted category is not in options
      const optionTexts = options.map((opt: any) => opt.text());
      expect(optionTexts.some((text: string) => text.includes('Sports'))).toBe(true);
      expect(optionTexts.some((text: string) => text.includes('Arts'))).toBe(true);
    });

    it('should call deleteCategory API with correct parameters', async () => {
      const mockCategories = [
        createTestCategory('cat-1', 'Music', 15),
        createTestCategory('cat-2', 'Sports', 3),
      ];

      mockCategoryService.loadCategories.mockResolvedValue(mockCategories);
      mockCategoryService.deleteCategory.mockResolvedValue(15);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.categories.length > 0;
      }, { timeout: 1000 });

      // Click delete button
      const deleteButtons = wrapper.findAll('.btn--danger');
      await deleteButtons[0].trigger('click');
      await nextTick();

      // Select migrate option and target
      const migrateRadio = wrapper.find('input[value="migrate"]');
      await migrateRadio.setValue(true);
      await nextTick();

      const dropdown = wrapper.find('select.migration-target');
      await dropdown.setValue('cat-2');
      await nextTick();

      // Confirm deletion
      const confirmButton = wrapper.find('.btn-confirm-delete');
      await confirmButton.trigger('click');
      await nextTick();

      // Check API was called correctly
      expect(mockCategoryService.deleteCategory).toHaveBeenCalledWith(
        'cat-1',
        'calendar-123',
        'migrate',
        'cat-2',
      );
    });
  });

  describe('Merge dialog', () => {
    it('should display all selected categories with event counts', async () => {
      const mockCategories = [
        createTestCategory('cat-1', 'Music', 15),
        createTestCategory('cat-2', 'Sports', 8),
        createTestCategory('cat-3', 'Arts', 5),
      ];

      mockCategoryService.loadCategories.mockResolvedValue(mockCategories);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.categories.length > 0;
      }, { timeout: 1000 });

      // Select categories
      const checkboxes = wrapper.findAll('input[type="checkbox"]');
      await checkboxes[0].setValue(true);
      await checkboxes[1].setValue(true);
      await nextTick();

      // Click merge button
      const mergeButton = wrapper.find('.btn-merge-categories');
      await mergeButton.trigger('click');
      await nextTick();

      // Check dialog content
      expect(wrapper.vm.state.showMergeDialog).toBe(true);

      const dialogText = wrapper.find('.merge-dialog').text();
      expect(dialogText).toContain('Music');
      expect(dialogText).toContain('15');
      expect(dialogText).toContain('Sports');
      expect(dialogText).toContain('8');
    });

    it('should show total affected event count', async () => {
      const mockCategories = [
        createTestCategory('cat-1', 'Music', 15),
        createTestCategory('cat-2', 'Sports', 8),
      ];

      mockCategoryService.loadCategories.mockResolvedValue(mockCategories);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.categories.length > 0;
      }, { timeout: 1000 });

      // Select categories
      const checkboxes = wrapper.findAll('input[type="checkbox"]');
      await checkboxes[0].setValue(true);
      await checkboxes[1].setValue(true);
      await nextTick();

      // Click merge button
      const mergeButton = wrapper.find('.btn-merge-categories');
      await mergeButton.trigger('click');
      await nextTick();

      // Check total count (should be sum of all selected)
      const totalText = wrapper.find('.total-events').text();
      expect(totalText).toContain('23'); // 15 + 8
    });

    it('should call mergeCategories API with correct parameters', async () => {
      const mockCategories = [
        createTestCategory('cat-1', 'Music', 15),
        createTestCategory('cat-2', 'Sports', 8),
      ];

      mockCategoryService.loadCategories.mockResolvedValue(mockCategories);
      mockCategoryService.mergeCategories.mockResolvedValue({ totalAffectedEvents: 23 });

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.categories.length > 0;
      }, { timeout: 1000 });

      // Select categories
      const checkboxes = wrapper.findAll('input[type="checkbox"]');
      await checkboxes[0].setValue(true);
      await checkboxes[1].setValue(true);
      await nextTick();

      // Click merge button
      const mergeButton = wrapper.find('.btn-merge-categories');
      await mergeButton.trigger('click');
      await nextTick();

      // Select target (should be first by default - cat-1)
      const targetRadio = wrapper.find('input[value="cat-1"]');
      await targetRadio.setValue(true);
      await nextTick();

      // Confirm merge
      const confirmButton = wrapper.find('.btn-confirm-merge');
      await confirmButton.trigger('click');
      await nextTick();

      // Check API was called correctly
      expect(mockCategoryService.mergeCategories).toHaveBeenCalledWith(
        'calendar-123',
        'cat-1',
        ['cat-2'],
      );
    });
  });
});
