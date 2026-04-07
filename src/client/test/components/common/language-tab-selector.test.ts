import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { ref } from 'vue';
import LanguageTabSelector from '@/client/components/common/language-tab-selector.vue';

/**
 * Tests for LanguageTabSelector ARIA tab contract and keyboard navigation.
 *
 * Validates:
 * - aria-controls on active tab points to a valid panel ID
 * - panelId/tabId helpers are exposed via defineExpose
 * - Roving tabindex: active tab has tabindex=0, others have tabindex=-1
 * - Arrow key navigation moves focus between tabs
 * - Home/End keys jump to first/last tab
 * - erroredTabs prop marks tabs with error styling and accessible labels
 */

// Stub i18next-vue
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      if (key === 'nav_label') return 'Language tabs';
      if (key === 'edit_content') return `Edit content in ${opts?.language}`;
      if (key === 'edit_content_error') return `Edit content in ${opts?.language} (has errors)`;
      if (key === 'add_language') return 'Add language';
      return key;
    },
  }),
}));

// Stub lucide-vue-next
vi.mock('lucide-vue-next', () => ({
  Plus: { template: '<span>+</span>' },
}));

// Stub useTabScroll
vi.mock('@/client/composables/useTabScroll', () => ({
  useTabScroll: () => ({
    tabsRef: ref(null),
    canScrollLeft: ref(false),
    canScrollRight: ref(false),
  }),
}));

const LANGUAGES = ['en', 'es', 'fr'];

// Track wrappers for cleanup
const wrappers: VueWrapper[] = [];

afterEach(() => {
  wrappers.forEach(w => w.unmount());
  wrappers.length = 0;
});

function createWrapper(props: Record<string, unknown> = {}) {
  const wrapper = mount(LanguageTabSelector, {
    props: {
      modelValue: 'en',
      languages: LANGUAGES,
      ...props,
    },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}

describe('LanguageTabSelector', () => {
  describe('ARIA contract', () => {
    it('should set aria-controls on each tab button with uid-prefixed panel ID', () => {
      const wrapper = createWrapper();
      const tabs = wrapper.findAll('[role="tab"]');

      expect(tabs).toHaveLength(3);

      // Each tab's aria-controls should match the pattern uid-lang-panel
      for (const tab of tabs) {
        const controls = tab.attributes('aria-controls');
        expect(controls).toBeDefined();
        expect(controls).toMatch(/-panel$/);
      }
    });

    it('should set unique IDs on tab buttons matching uid-lang-tab pattern', () => {
      const wrapper = createWrapper();
      const tabs = wrapper.findAll('[role="tab"]');

      for (const tab of tabs) {
        const id = tab.attributes('id');
        expect(id).toBeDefined();
        expect(id).toMatch(/-tab$/);
      }
    });

    it('should expose panelId and tabId helpers via defineExpose', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as unknown as {
        panelId: (lang: string) => string;
        tabId: (lang: string) => string;
      };

      expect(typeof vm.panelId).toBe('function');
      expect(typeof vm.tabId).toBe('function');

      const panelId = vm.panelId('en');
      const tabId = vm.tabId('en');

      expect(panelId).toMatch(/-en-panel$/);
      expect(tabId).toMatch(/-en-tab$/);
    });

    it('should have consistent IDs: tab aria-controls matches panelId', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as unknown as {
        panelId: (lang: string) => string;
      };

      const activeTab = wrapper.find('[role="tab"][aria-selected="true"]');
      expect(activeTab.attributes('aria-controls')).toBe(vm.panelId('en'));
    });
  });

  describe('roving tabindex', () => {
    it('should set tabindex=0 on active tab and tabindex=-1 on inactive tabs', () => {
      const wrapper = createWrapper({ modelValue: 'es' });
      const tabs = wrapper.findAll('[role="tab"]');

      const enTab = tabs.find(t => t.text().includes('English'));
      const esTab = tabs.find(t => t.text().includes('Spanish'));
      const frTab = tabs.find(t => t.text().includes('French'));

      expect(enTab!.attributes('tabindex')).toBe('-1');
      expect(esTab!.attributes('tabindex')).toBe('0');
      expect(frTab!.attributes('tabindex')).toBe('-1');
    });
  });

  describe('keyboard navigation', () => {
    it('should emit update:modelValue on ArrowRight from first tab', async () => {
      const wrapper = createWrapper({ modelValue: 'en' });
      const activeTab = wrapper.find('[role="tab"][aria-selected="true"]');

      await activeTab.trigger('keydown', { key: 'ArrowRight' });

      const emitted = wrapper.emitted('update:modelValue');
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual(['es']);
    });

    it('should emit update:modelValue on ArrowLeft wrapping to last tab', async () => {
      const wrapper = createWrapper({ modelValue: 'en' });
      const activeTab = wrapper.find('[role="tab"][aria-selected="true"]');

      await activeTab.trigger('keydown', { key: 'ArrowLeft' });

      const emitted = wrapper.emitted('update:modelValue');
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual(['fr']);
    });

    it('should emit update:modelValue on Home key to first tab', async () => {
      const wrapper = createWrapper({ modelValue: 'fr' });
      const activeTab = wrapper.find('[role="tab"][aria-selected="true"]');

      await activeTab.trigger('keydown', { key: 'Home' });

      const emitted = wrapper.emitted('update:modelValue');
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual(['en']);
    });

    it('should emit update:modelValue on End key to last tab', async () => {
      const wrapper = createWrapper({ modelValue: 'en' });
      const activeTab = wrapper.find('[role="tab"][aria-selected="true"]');

      await activeTab.trigger('keydown', { key: 'End' });

      const emitted = wrapper.emitted('update:modelValue');
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual(['fr']);
    });
  });

  describe('erroredTabs prop', () => {
    it('should mark errored tab with has-error class, error aria-label, and error-dot span', () => {
      const wrapper = createWrapper({ erroredTabs: ['es'] });
      const tabs = wrapper.findAll('[role="tab"]');

      const esTab = tabs.find(t => t.text().includes('Spanish'));
      expect(esTab).toBeDefined();

      // has-error class is applied
      expect(esTab!.classes()).toContain('has-error');

      // aria-label uses the error translation variant
      expect(esTab!.attributes('aria-label')).toBe('Edit content in Spanish (has errors)');

      // error-dot span is rendered inside the errored tab
      const errorDot = esTab!.find('.error-dot');
      expect(errorDot.exists()).toBe(true);
      expect(errorDot.attributes('aria-hidden')).toBe('true');

      // Non-errored tabs should NOT have error styling
      const enTab = tabs.find(t => t.text().includes('English'));
      expect(enTab!.classes()).not.toContain('has-error');
      expect(enTab!.attributes('aria-label')).toBe('Edit content in English');
      expect(enTab!.find('.error-dot').exists()).toBe(false);
    });
  });
});
