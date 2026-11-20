import { describe, it, expect, beforeAll } from 'vitest';
import { mount } from '@vue/test-utils';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import LanguagePicker from '@/client/components/common/language-picker.vue';
import enSystem from '@/client/locales/en/system.json';

/**
 * Sheet stub: renders the slot inside a native <dialog> so the picker's
 * own markup can be asserted without the real Sheet's dependencies.
 */
const SheetStub = {
  props: ['title'],
  template: '<dialog><h2>{{ title }}</h2><slot/></dialog>',
  emits: ['close'],
};

beforeAll(async () => {
  await i18next.init({
    lng: 'en',
    resources: { en: { system: enSystem } },
  });
});

function mountPicker() {
  return mount(LanguagePicker, {
    attachTo: document.body,
    props: { languages: ['en', 'es', 'fr'], selectedLanguages: ['en'] },
    global: {
      plugins: [[I18NextVue, { i18next }] as const],
      stubs: { Sheet: SheetStub },
    },
  });
}

describe('LanguagePicker', () => {
  describe('accessible names', () => {
    it('names the search field with a visible, associated label', () => {
      const wrapper = mountPicker();

      try {
        const search = wrapper.find('input[type="search"]').element as HTMLInputElement;
        const labels = Array.from(search.labels ?? []);
        expect(labels).toHaveLength(1);
        expect(labels[0].textContent?.trim()).toBe('Search languages');
        // The visible label is the name; the placeholder is only an example.
        expect(search.placeholder).toBe('Search for a language');
        expect(search.hasAttribute('aria-label')).toBe(false);
        expect(search.hasAttribute('aria-labelledby')).toBe(false);
      }
      finally {
        wrapper.unmount();
      }
    });
  });
});
