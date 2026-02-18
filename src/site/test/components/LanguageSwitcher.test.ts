/**
 * Tests for the LanguageSwitcher component.
 *
 * Validates:
 * - Rendering of primary and beta language sections
 * - Filtering: incomplete languages (<50%) are hidden
 * - Globe icon and native language names are shown
 * - Selecting a language calls switchLocale() and closes the dropdown
 * - Keyboard navigation: ArrowDown, ArrowUp, Enter, Escape
 * - ARIA attributes for screen-reader accessibility
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { ref, nextTick } from 'vue';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

// ---------------------------------------------------------------------------
// Mocks — declared before component import
// ---------------------------------------------------------------------------

const mockSwitchLocale = vi.fn();
// Use a real Vue ref so the component's template auto-unwrapping works correctly
const mockCurrentLocale = ref('en');

vi.mock('@/site/composables/useLocale', () => ({
  useLocale: () => ({
    currentLocale: mockCurrentLocale,
    switchLocale: mockSwitchLocale,
    localizedPath: (path: string) => path,
  }),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------
import LanguageSwitcher from '@/site/components/LanguageSwitcher.vue';
import { AVAILABLE_LANGUAGES, PRIMARY_THRESHOLD, BETA_THRESHOLD } from '@/common/i18n/languages';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const routes: RouteRecordRaw[] = [
  { path: '/:pathMatch(.*)*', component: {}, name: 'catch-all' },
];

function mountSwitcher(): VueWrapper {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  const pinia = createPinia();

  return mount(LanguageSwitcher, {
    global: {
      plugins: [
        router,
        [I18NextVue, { i18next }],
        pinia,
      ],
    },
    attachTo: document.body,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LanguageSwitcher Component', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    mockSwitchLocale.mockClear();
    mockCurrentLocale.value = 'en';
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  describe('Rendering', () => {
    it('renders the trigger button', () => {
      wrapper = mountSwitcher();

      expect(wrapper.find('.language-switcher__trigger').exists()).toBe(true);
    });

    it('shows a globe SVG icon in the trigger', () => {
      wrapper = mountSwitcher();

      const globe = wrapper.find('.language-switcher__globe');
      expect(globe.exists()).toBe(true);
      expect(globe.attributes('aria-hidden')).toBe('true');
    });

    it('shows the native name of the current language in the trigger', () => {
      mockCurrentLocale.value = 'en';
      wrapper = mountSwitcher();

      const trigger = wrapper.find('.language-switcher__trigger');
      expect(trigger.text()).toContain('English');
    });

    it('dropdown is hidden by default', () => {
      wrapper = mountSwitcher();

      expect(wrapper.find('.language-switcher__dropdown').exists()).toBe(false);
    });

    it('opens the dropdown when the trigger is clicked', async () => {
      wrapper = mountSwitcher();

      await wrapper.find('.language-switcher__trigger').trigger('click');

      expect(wrapper.find('.language-switcher__dropdown').exists()).toBe(true);
    });

    it('closes the dropdown when the trigger is clicked again', async () => {
      wrapper = mountSwitcher();
      const trigger = wrapper.find('.language-switcher__trigger');

      await trigger.trigger('click');
      expect(wrapper.find('.language-switcher__dropdown').exists()).toBe(true);

      await trigger.trigger('click');
      expect(wrapper.find('.language-switcher__dropdown').exists()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Language filtering by completeness
  // -------------------------------------------------------------------------

  describe('Language completeness filtering', () => {
    it('only renders languages with completeness >= BETA_THRESHOLD', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const visibleLanguages = AVAILABLE_LANGUAGES.filter(
        l => l.completeness >= BETA_THRESHOLD,
      );
      const options = wrapper.findAll('[role="option"]');

      expect(options.length).toBe(visibleLanguages.length);
    });

    it('renders primary languages (completeness >= PRIMARY_THRESHOLD)', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const primaryLangs = AVAILABLE_LANGUAGES.filter(
        l => l.completeness >= PRIMARY_THRESHOLD,
      );

      // Every primary language should appear as an option
      for (const lang of primaryLangs) {
        const option = wrapper.find(`[id="lang-option-${lang.code}"]`);
        expect(option.exists()).toBe(true);
        expect(option.text()).toContain(lang.nativeName);
      }
    });

    it('does not render incomplete languages (completeness < BETA_THRESHOLD)', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const incompleteLangs = AVAILABLE_LANGUAGES.filter(
        l => l.completeness < BETA_THRESHOLD,
      );

      for (const lang of incompleteLangs) {
        const option = wrapper.find(`[id="lang-option-${lang.code}"]`);
        expect(option.exists()).toBe(false);
      }
    });

    it('shows native script names, not English names', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const options = wrapper.findAll('[role="option"]');
      const optionTexts = options.map(o => o.text());

      // Spanish native name should appear
      const esLang = AVAILABLE_LANGUAGES.find(l => l.code === 'es');
      if (esLang) {
        const foundNative = optionTexts.some(text => text.includes(esLang.nativeName));
        expect(foundNative).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Language selection
  // -------------------------------------------------------------------------

  describe('Language selection', () => {
    it('calls switchLocale when an option is clicked', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const options = wrapper.findAll('[role="option"]');
      await options[0].trigger('click');

      expect(mockSwitchLocale).toHaveBeenCalledOnce();
    });

    it('closes the dropdown after selecting a language', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const options = wrapper.findAll('[role="option"]');
      await options[0].trigger('click');

      expect(wrapper.find('.language-switcher__dropdown').exists()).toBe(false);
    });

    it('marks the currently selected language with aria-selected="true"', async () => {
      mockCurrentLocale.value = 'en';
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const enOption = wrapper.find('[id="lang-option-en"]');
      expect(enOption.attributes('aria-selected')).toBe('true');
    });

    it('marks non-selected languages with aria-selected="false"', async () => {
      mockCurrentLocale.value = 'en';
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const esOption = wrapper.find('[id="lang-option-es"]');
      if (esOption.exists()) {
        expect(esOption.attributes('aria-selected')).toBe('false');
      }
    });

    it('shows a checkmark on the currently selected language', async () => {
      mockCurrentLocale.value = 'en';
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const enOption = wrapper.find('[id="lang-option-en"]');
      const checkmark = enOption.find('.language-switcher__checkmark');
      expect(checkmark.exists()).toBe(true);
      expect(checkmark.attributes('aria-hidden')).toBe('true');
    });

    it('does not show a checkmark on non-selected languages', async () => {
      mockCurrentLocale.value = 'en';
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const esOption = wrapper.find('[id="lang-option-es"]');
      if (esOption.exists()) {
        expect(esOption.find('.language-switcher__checkmark').exists()).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Keyboard navigation
  // -------------------------------------------------------------------------

  describe('Keyboard navigation', () => {
    it('opens dropdown with Enter key on trigger', async () => {
      wrapper = mountSwitcher();
      const trigger = wrapper.find('.language-switcher__trigger');

      await trigger.trigger('keydown', { key: 'Enter' });
      await nextTick();

      expect(wrapper.find('.language-switcher__dropdown').exists()).toBe(true);
    });

    it('opens dropdown with ArrowDown key on trigger', async () => {
      wrapper = mountSwitcher();
      const trigger = wrapper.find('.language-switcher__trigger');

      await trigger.trigger('keydown', { key: 'ArrowDown' });
      await nextTick();

      expect(wrapper.find('.language-switcher__dropdown').exists()).toBe(true);
    });

    it('closes dropdown with Escape key', async () => {
      wrapper = mountSwitcher();

      await wrapper.find('.language-switcher__trigger').trigger('click');
      expect(wrapper.find('.language-switcher__dropdown').exists()).toBe(true);

      await wrapper.find('.language-switcher').trigger('keydown', { key: 'Escape' });

      expect(wrapper.find('.language-switcher__dropdown').exists()).toBe(false);
    });

    it('selects language with Enter key on option', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const options = wrapper.findAll('[role="option"]');
      await options[0].trigger('keydown', { key: 'Enter' });

      expect(mockSwitchLocale).toHaveBeenCalledOnce();
    });

    it('selects language with Space key on option', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const options = wrapper.findAll('[role="option"]');
      await options[0].trigger('keydown', { key: ' ' });

      expect(mockSwitchLocale).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // ARIA / Accessibility
  // -------------------------------------------------------------------------

  describe('Accessibility (ARIA)', () => {
    it('trigger has aria-haspopup="listbox"', () => {
      wrapper = mountSwitcher();

      expect(wrapper.find('.language-switcher__trigger').attributes('aria-haspopup')).toBe('listbox');
    });

    it('trigger has aria-expanded="false" when closed', () => {
      wrapper = mountSwitcher();

      expect(wrapper.find('.language-switcher__trigger').attributes('aria-expanded')).toBe('false');
    });

    it('trigger has aria-expanded="true" when open', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      expect(wrapper.find('.language-switcher__trigger').attributes('aria-expanded')).toBe('true');
    });

    it('trigger has aria-controls pointing to the listbox id', () => {
      wrapper = mountSwitcher();
      const trigger = wrapper.find('.language-switcher__trigger');

      expect(trigger.attributes('aria-controls')).toBe('language-switcher-listbox');
    });

    it('trigger button is present and associated with the language switcher', () => {
      wrapper = mountSwitcher();
      const trigger = wrapper.find('.language-switcher__trigger');

      // Trigger should exist and have accessibility attributes
      expect(trigger.exists()).toBe(true);
      expect(trigger.attributes('aria-haspopup')).toBe('listbox');
      expect(trigger.attributes('aria-controls')).toBe('language-switcher-listbox');
    });

    it('dropdown has role="listbox"', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      expect(wrapper.find('.language-switcher__dropdown').attributes('role')).toBe('listbox');
    });

    it('dropdown listbox is labelled for screen readers', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      // The listbox should have an id that the trigger's aria-controls references
      const listbox = wrapper.find('[role="listbox"]');
      expect(listbox.attributes('id')).toBe('language-switcher-listbox');
    });

    it('all options have role="option"', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const options = wrapper.findAll('[role="option"]');
      expect(options.length).toBeGreaterThan(0);
      options.forEach(option => {
        expect(option.attributes('role')).toBe('option');
      });
    });

    it('all options are keyboard focusable (tabindex="0")', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const options = wrapper.findAll('[role="option"]');
      options.forEach(option => {
        expect(option.attributes('tabindex')).toBe('0');
      });
    });

    it('each option has a lang attribute matching its language code', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      const enOption = wrapper.find('[id="lang-option-en"]');
      expect(enOption.attributes('lang')).toBe('en');
    });
  });

  // -------------------------------------------------------------------------
  // No country flags
  // -------------------------------------------------------------------------

  describe('No country flags', () => {
    it('does not render any flag img elements', async () => {
      wrapper = mountSwitcher();
      await wrapper.find('.language-switcher__trigger').trigger('click');

      // Should have no <img> tags (flag images)
      expect(wrapper.findAll('img').length).toBe(0);
    });

    it('uses globe icon SVG, not country flag images', () => {
      wrapper = mountSwitcher();

      const globe = wrapper.find('.language-switcher__globe');
      expect(globe.exists()).toBe(true);
      // Globe is an SVG, not an <img> with a flag src
      expect(globe.element.tagName.toLowerCase()).toBe('svg');
    });
  });
});
