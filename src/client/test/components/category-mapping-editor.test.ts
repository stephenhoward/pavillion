import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { createPinia } from 'pinia';
import CategoryMappingEditor from '@/client/components/logged_in/category-mapping-editor.vue';

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

  describe('rendering', () => {
    it('renders a row for each source category', () => {
      wrapper = mountEditor({ sourceCategories, localCategories, modelValue: [] });

      const rows = wrapper.findAll('.mapping-row');
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
        // First option is "No mapping", then local categories
        expect(options).toHaveLength(3);
        expect(options[1].text()).toBe('Arts & Music');
        expect(options[2].text()).toBe('Recreation');
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
});
