import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import CategoryEditor from '@/client/components/logged_in/calendar-management/category-editor.vue';
import CategoryService from '@/client/service/category';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';
import { DuplicateCategoryNameError } from '@/common/exceptions/category';

// Minimal translations required by CategoryEditor
const CATEGORY_TRANSLATIONS = {
  'management.add_category_title': 'Add a Category',
  'management.edit_category_title': 'Edit Category',
  'management.category_name_help': 'Enter a descriptive name for this category',
  'management.category_name_placeholder': 'Category name',
  'management.create_button': 'Create Category',
  'management.cancel_button': 'Cancel',
  'management.save_button': 'Save Changes',
  'management.creating': 'Creating category...',
  'management.updating': 'Updating category...',
  'management.error_empty_name': 'Category name cannot be empty',
  'management.error_create_category': 'Error creating category',
  'management.error_update_category': 'Error updating category',
  'management.error_duplicate_name': 'A category with this name already exists',
  'management.add_language': 'Add Language',
};

/**
 * Create a test EventCategory with English content
 */
function createNewCategory(name = ''): EventCategory {
  const category = new EventCategory('', 'calendar-123');
  category.addContent(new EventCategoryContent('en', name));
  return category;
}

/**
 * Mount the CategoryEditor with stubs to bypass dialog/modal limitations in happy-dom
 */
const mountEditor = (category: EventCategory) => {
  return mount(CategoryEditor, {
    global: {
      plugins: [
        [I18NextVue, { i18next }],
        createPinia(),
      ],
      stubs: {
        // Stub ModalLayout to render slot content directly
        ModalLayout: {
          template: '<div><slot /></div>',
          props: ['title', 'modalClass'],
          emits: ['close'],
        },
        // Stub LanguagePicker — not needed in these tests
        LanguagePicker: { template: '<div />' },
        // Stub PillButton to render as a button
        PillButton: {
          template: '<button @click="$emit(\'click\')" :disabled="disabled"><slot /></button>',
          props: ['variant', 'disabled'],
          emits: ['click'],
        },
        // Stub lucide icon used in the remove-language button
        X: { template: '<span />' },
      },
    },
    props: { category },
  });
};

describe('CategoryEditor — duplicate name validation', () => {
  beforeAll(async () => {
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          categories: CATEGORY_TRANSLATIONS,
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows duplicate name error when server returns DuplicateCategoryNameError', async () => {
    const category = createNewCategory('Technology');

    vi.spyOn(CategoryService.prototype, 'saveCategory').mockRejectedValue(
      new DuplicateCategoryNameError(),
    );

    const wrapper = mountEditor(category);
    await flushPromises();

    // Find and click the primary save button (PillButton stub renders a <button>)
    const buttons = wrapper.findAll('button');
    const saveBtn = buttons.find(b => b.text() === 'Create Category');
    expect(saveBtn).toBeTruthy();
    await saveBtn!.trigger('click');
    await flushPromises();

    const alert = wrapper.find('.alert.alert--error');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toBe('A category with this name already exists');

    wrapper.unmount();
  });

  it('shows generic create error for non-duplicate failures on a new category', async () => {
    const category = createNewCategory('Technology');

    vi.spyOn(CategoryService.prototype, 'saveCategory').mockRejectedValue(
      new Error('Network error'),
    );

    const wrapper = mountEditor(category);
    await flushPromises();

    const buttons = wrapper.findAll('button');
    const saveBtn = buttons.find(b => b.text() === 'Create Category');
    expect(saveBtn).toBeTruthy();
    await saveBtn!.trigger('click');
    await flushPromises();

    const alert = wrapper.find('.alert.alert--error');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toBe('Error creating category');

    wrapper.unmount();
  });

  it('emits saved and close events when save succeeds', async () => {
    const category = createNewCategory('Unique Name');
    const savedCategory = createNewCategory('Unique Name');

    vi.spyOn(CategoryService.prototype, 'saveCategory').mockResolvedValue(savedCategory);

    const wrapper = mountEditor(category);
    await flushPromises();

    const buttons = wrapper.findAll('button');
    const saveBtn = buttons.find(b => b.text() === 'Create Category');
    expect(saveBtn).toBeTruthy();
    await saveBtn!.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('saved')).toBeTruthy();
    expect(wrapper.emitted('close')).toBeTruthy();

    wrapper.unmount();
  });
});
