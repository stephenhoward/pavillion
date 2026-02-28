import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { createPinia } from 'pinia';
import CategoryMappingEditor from '@/client/components/logged_in/category-mapping-editor.vue';
import { ADD_CATEGORY_VALUE } from '@/client/components/logged_in/category-mapping-constants';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: {} }],
});

function mountEditor(props: Record<string, unknown>) {
  i18next.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        calendars: {
          category_mapping: {
            no_mapping: 'No mapping',
            no_source_categories: 'Source calendar has no categories',
            dropdown_label: 'Map "{{name}}" to local category',
            source_column_label: 'Their Categories',
            local_column_label: 'Our Categories',
            add_category_toggle: 'Add this category',
            add_category_toggled: 'Add this category ✓',
            add_category_toggle_label: 'Add "{{name}}" as a local category',
            add_category_option: '+ Add this category',
          },
        },
      },
    },
  });

  return mount(CategoryMappingEditor, {
    global: {
      plugins: [router, [I18NextVue, { i18next }], createPinia()],
    },
    props,
  });
}

describe('CategoryMappingEditor', () => {
  let wrapper: ReturnType<typeof mountEditor>;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const sourceCategories = [
    { id: 'src-1', name: 'Music' },
    { id: 'src-2', name: 'Sports' },
  ];

  const localCategories = [
    { id: 'loc-1', name: 'Arts & Music' },
    { id: 'loc-2', name: 'Recreation' },
  ];

  describe('with local categories (dropdown mode)', () => {
    describe('rendering', () => {
      it('renders column headers', () => {
        wrapper = mountEditor({ sourceCategories, localCategories, modelValue: [] });

        const headerRow = wrapper.find('.mapping-row.column-headers');
        expect(headerRow.exists()).toBe(true);
        expect(headerRow.text()).toContain('Their Categories');
        expect(headerRow.text()).toContain('Our Categories');
      });

      it('renders a row for each source category', () => {
        wrapper = mountEditor({ sourceCategories, localCategories, modelValue: [] });

        const rows = wrapper.findAll('.mapping-row:not(.column-headers)');
        expect(rows).toHaveLength(2);
        expect(rows[0].text()).toContain('Music');
        expect(rows[1].text()).toContain('Sports');
      });

      it('renders the "No mapping" option in each dropdown', () => {
        wrapper = mountEditor({ sourceCategories, localCategories, modelValue: [] });

        const selects = wrapper.findAll('select');
        expect(selects).toHaveLength(2);

        selects.forEach(select => {
          const options = select.findAll('option');
          expect(options[0].text()).toBe('No mapping');
          expect(options[0].element.value).toBe('');
        });
      });

      it('renders local category options in each dropdown', () => {
        wrapper = mountEditor({ sourceCategories, localCategories, modelValue: [] });

        const selects = wrapper.findAll('select');
        selects.forEach(select => {
          const options = select.findAll('option');
          // First option is "No mapping", then local categories, then "Add this category"
          expect(options).toHaveLength(4);
          expect(options[1].text()).toBe('Arts & Music');
          expect(options[2].text()).toBe('Recreation');
        });
      });

      it('renders the "Add this category" option as the last dropdown option', () => {
        wrapper = mountEditor({ sourceCategories, localCategories, modelValue: [] });

        const selects = wrapper.findAll('select');
        selects.forEach(select => {
          const options = select.findAll('option');
          const lastOption = options[options.length - 1];
          expect(lastOption.element.value).toBe(ADD_CATEGORY_VALUE);
          expect(lastOption.text()).toBe('+ Add this category');
        });
      });

      it('shows the empty state when sourceCategories is empty', () => {
        wrapper = mountEditor({ sourceCategories: [], localCategories, modelValue: [] });

        expect(wrapper.find('.mapping-row').exists()).toBe(false);
        expect(wrapper.find('.empty-state').exists()).toBe(true);
        expect(wrapper.find('.empty-state').text()).toContain('Source calendar has no categories');
      });

      it('does not show empty state when sourceCategories is populated', () => {
        wrapper = mountEditor({ sourceCategories, localCategories, modelValue: [] });

        expect(wrapper.find('.empty-state').exists()).toBe(false);
      });

      it('does not render toggle buttons when local categories exist', () => {
        wrapper = mountEditor({ sourceCategories, localCategories, modelValue: [] });

        expect(wrapper.find('.add-toggle').exists()).toBe(false);
      });
    });

    describe('pre-populated mappings', () => {
      it('reflects existing mapping entries in the dropdowns', () => {
        const modelValue = [
          { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: 'loc-1' },
        ];

        wrapper = mountEditor({ sourceCategories, localCategories, modelValue });

        const selects = wrapper.findAll('select');
        // First source category (Music) is mapped to loc-1
        expect((selects[0].element as HTMLSelectElement).value).toBe('loc-1');
        // Second source category (Sports) has no mapping
        expect((selects[1].element as HTMLSelectElement).value).toBe('');
      });
    });

    describe('selecting a local category', () => {
      it('emits update:modelValue with the new mapping when a local category is selected', async () => {
        wrapper = mountEditor({ sourceCategories, localCategories, modelValue: [] });

        const selects = wrapper.findAll('select');
        // Select loc-1 for src-1
        await selects[0].setValue('loc-1');

        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted).toBeTruthy();
        expect(emitted![0][0]).toEqual([
          { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: 'loc-1' },
        ]);
      });

      it('updates an existing mapping when a different local category is selected', async () => {
        const modelValue = [
          { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: 'loc-1' },
        ];

        wrapper = mountEditor({ sourceCategories, localCategories, modelValue });

        const selects = wrapper.findAll('select');
        // Re-map src-1 to loc-2
        await selects[0].setValue('loc-2');

        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted).toBeTruthy();
        expect(emitted![0][0]).toEqual([
          { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: 'loc-2' },
        ]);
      });

      it('preserves other mappings when one is updated', async () => {
        const modelValue = [
          { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: 'loc-1' },
          { sourceCategoryId: 'src-2', sourceCategoryName: 'Sports', localCategoryId: 'loc-2' },
        ];

        wrapper = mountEditor({ sourceCategories, localCategories, modelValue });

        const selects = wrapper.findAll('select');
        // Re-map src-1 to loc-2
        await selects[0].setValue('loc-2');

        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted).toBeTruthy();
        const newValue = emitted![0][0] as typeof modelValue;
        // src-2 mapping should still be present
        expect(newValue.some(m => m.sourceCategoryId === 'src-2' && m.localCategoryId === 'loc-2')).toBe(true);
      });
    });

    describe('selecting "No mapping"', () => {
      it('emits update:modelValue without the mapping when "No mapping" is selected', async () => {
        const modelValue = [
          { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: 'loc-1' },
        ];

        wrapper = mountEditor({ sourceCategories, localCategories, modelValue });

        const selects = wrapper.findAll('select');
        // Select "No mapping" (empty string) for src-1
        await selects[0].setValue('');

        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted).toBeTruthy();
        // Mapping for src-1 should be removed
        expect(emitted![0][0]).toEqual([]);
      });

      it('preserves other mappings when one is cleared', async () => {
        const modelValue = [
          { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: 'loc-1' },
          { sourceCategoryId: 'src-2', sourceCategoryName: 'Sports', localCategoryId: 'loc-2' },
        ];

        wrapper = mountEditor({ sourceCategories, localCategories, modelValue });

        const selects = wrapper.findAll('select');
        // Clear mapping for src-1
        await selects[0].setValue('');

        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted).toBeTruthy();
        const newValue = emitted![0][0] as typeof modelValue;
        expect(newValue).toHaveLength(1);
        expect(newValue[0].sourceCategoryId).toBe('src-2');
      });
    });

    describe('selecting "Add this category" from dropdown', () => {
      it('emits update:modelValue with __add__ when "Add this category" is selected', async () => {
        wrapper = mountEditor({ sourceCategories, localCategories, modelValue: [] });

        const selects = wrapper.findAll('select');
        await selects[0].setValue(ADD_CATEGORY_VALUE);

        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted).toBeTruthy();
        expect(emitted![0][0]).toEqual([
          { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: ADD_CATEGORY_VALUE },
        ]);
      });

      it('switching from __add__ to a real local category works', async () => {
        const modelValue = [
          { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: ADD_CATEGORY_VALUE },
        ];

        wrapper = mountEditor({ sourceCategories, localCategories, modelValue });

        const selects = wrapper.findAll('select');
        await selects[0].setValue('loc-1');

        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted).toBeTruthy();
        expect(emitted![0][0]).toEqual([
          { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: 'loc-1' },
        ]);
      });
    });
  });

  describe('without local categories (toggle button mode)', () => {
    describe('rendering', () => {
      it('does not render column headers when no local categories', () => {
        wrapper = mountEditor({ sourceCategories, localCategories: [], modelValue: [] });

        expect(wrapper.find('.mapping-row.column-headers').exists()).toBe(false);
      });

      it('renders a row for each source category', () => {
        wrapper = mountEditor({ sourceCategories, localCategories: [], modelValue: [] });

        const rows = wrapper.findAll('.mapping-row:not(.column-headers)');
        expect(rows).toHaveLength(2);
        expect(rows[0].text()).toContain('Music');
        expect(rows[1].text()).toContain('Sports');
      });

      it('renders toggle buttons instead of dropdowns', () => {
        wrapper = mountEditor({ sourceCategories, localCategories: [], modelValue: [] });

        expect(wrapper.findAll('select')).toHaveLength(0);
        expect(wrapper.findAll('.add-toggle')).toHaveLength(2);
      });

      it('toggle buttons show unpressed state by default', () => {
        wrapper = mountEditor({ sourceCategories, localCategories: [], modelValue: [] });

        const buttons = wrapper.findAll('.add-toggle');
        buttons.forEach(btn => {
          expect(btn.attributes('aria-checked')).toBe('false');
          expect(btn.classes()).not.toContain('active');
        });
      });

      it('toggle button text reflects "Add this category"', () => {
        wrapper = mountEditor({ sourceCategories, localCategories: [], modelValue: [] });

        const buttons = wrapper.findAll('.add-toggle');
        expect(buttons[0].text()).toBe('Add this category');
      });
    });

    describe('toggling "Add this category"', () => {
      it('emits update:modelValue with __add__ when toggle is clicked', async () => {
        wrapper = mountEditor({ sourceCategories, localCategories: [], modelValue: [] });

        const buttons = wrapper.findAll('.add-toggle');
        await buttons[0].trigger('click');

        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted).toBeTruthy();
        expect(emitted![0][0]).toEqual([
          { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: ADD_CATEGORY_VALUE },
        ]);
      });

      it('shows active state when toggled on', () => {
        const modelValue = [
          { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: ADD_CATEGORY_VALUE },
        ];

        wrapper = mountEditor({ sourceCategories, localCategories: [], modelValue });

        const buttons = wrapper.findAll('.add-toggle');
        expect(buttons[0].attributes('aria-checked')).toBe('true');
        expect(buttons[0].classes()).toContain('active');
      });

      it('emits removal of mapping when active toggle is clicked again', async () => {
        const modelValue = [
          { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: ADD_CATEGORY_VALUE },
        ];

        wrapper = mountEditor({ sourceCategories, localCategories: [], modelValue });

        const buttons = wrapper.findAll('.add-toggle');
        await buttons[0].trigger('click');

        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted).toBeTruthy();
        // Mapping for src-1 should be removed (toggled off)
        expect(emitted![0][0]).toEqual([]);
      });

      it('toggling one row does not affect others', async () => {
        wrapper = mountEditor({ sourceCategories, localCategories: [], modelValue: [] });

        const buttons = wrapper.findAll('.add-toggle');
        await buttons[1].trigger('click');

        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted).toBeTruthy();
        expect(emitted![0][0]).toEqual([
          { sourceCategoryId: 'src-2', sourceCategoryName: 'Sports', localCategoryId: ADD_CATEGORY_VALUE },
        ]);
      });

      it('preserves other add-mappings when one is toggled', async () => {
        const modelValue = [
          { sourceCategoryId: 'src-2', sourceCategoryName: 'Sports', localCategoryId: ADD_CATEGORY_VALUE },
        ];

        wrapper = mountEditor({ sourceCategories, localCategories: [], modelValue });

        const buttons = wrapper.findAll('.add-toggle');
        await buttons[0].trigger('click');

        const emitted = wrapper.emitted('update:modelValue');
        expect(emitted).toBeTruthy();
        const newValue = emitted![0][0] as typeof modelValue;
        expect(newValue).toHaveLength(2);
        expect(newValue.some(m => m.sourceCategoryId === 'src-2' && m.localCategoryId === ADD_CATEGORY_VALUE)).toBe(true);
        expect(newValue.some(m => m.sourceCategoryId === 'src-1' && m.localCategoryId === ADD_CATEGORY_VALUE)).toBe(true);
      });
    });
  });
});
