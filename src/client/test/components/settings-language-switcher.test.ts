import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { mountComponent } from '@/client/test/lib/vue';
import SettingsRoot from '@/client/components/logged_in/settings/root.vue';
import AccountService from '@/client/service/account';
import SubscriptionService from '@/client/service/subscription';
import * as localeService from '@/client/service/locale';
import { AVAILABLE_LANGUAGES } from '@/common/i18n/languages';
import { Account } from '@/common/model/account';

const routes: RouteRecordRaw[] = [
  { path: '/settings', component: {}, name: 'settings' },
  { path: '/logout', component: {}, name: 'logout' },
  { path: '/admin/settings', component: {}, name: 'admin-settings' },
];

/**
 * Build a minimal Account object for mocking getProfile()
 */
function buildProfile(language = 'en'): Account {
  const account = new Account('user-1', 'testuser', 'test@example.com');
  account.displayName = 'Test User';
  account.language = language;
  return account;
}

/**
 * Mount the settings root component with sensible defaults
 */
function mountSettings() {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  const mockAuthn = {
    isAdmin: () => false,
    userEmail: () => 'test@example.com',
  };

  const wrapper = mountComponent(SettingsRoot, router, {
    provide: {
      authn: mockAuthn,
    },
    stubs: {
      EmailModal: true,
      PasswordModal: true,
    },
  });

  return { wrapper, router };
}

describe('Settings Language Switcher', () => {
  beforeEach(() => {
    // Default: profile returns English, subscription disabled, language changes succeed
    vi.spyOn(AccountService.prototype, 'getProfile').mockResolvedValue(buildProfile('en'));
    vi.spyOn(AccountService.prototype, 'updateLanguage').mockResolvedValue(undefined);
    vi.spyOn(SubscriptionService.prototype, 'getOptions').mockResolvedValue({ enabled: false });
    vi.spyOn(localeService, 'changeLanguage').mockResolvedValue(undefined);
    vi.spyOn(localeService, 'applyAccountLanguage').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('dropdown population', () => {
    it('renders a language select element', async () => {
      const { wrapper } = mountSettings();
      await nextTick();

      expect(wrapper.find('select#language').exists()).toBe(true);
    });

    it('populates options from AVAILABLE_LANGUAGES', async () => {
      const { wrapper } = mountSettings();
      await nextTick();

      const options = wrapper.findAll('select#language option');
      expect(options.length).toBe(AVAILABLE_LANGUAGES.length);
    });

    it('uses nativeName as the option display text', async () => {
      const { wrapper } = mountSettings();
      await nextTick();

      const options = wrapper.findAll('select#language option');
      const optionTexts = options.map(o => o.text());

      for (const lang of AVAILABLE_LANGUAGES) {
        expect(optionTexts).toContain(lang.nativeName);
      }
    });

    it('uses language code as the option value', async () => {
      const { wrapper } = mountSettings();
      await nextTick();

      const options = wrapper.findAll('select#language option');
      const optionValues = options.map(o => o.attributes('value'));

      for (const lang of AVAILABLE_LANGUAGES) {
        expect(optionValues).toContain(lang.code);
      }
    });
  });

  describe('initial value', () => {
    it('reflects the language loaded from the user profile', async () => {
      vi.spyOn(AccountService.prototype, 'getProfile').mockResolvedValue(buildProfile('es'));

      const { wrapper } = mountSettings();

      // Wait for onMounted / loadProfile to complete
      await flushPromises();

      const select = wrapper.find<HTMLSelectElement>('select#language');
      expect(select.element.value).toBe('es');
    });

    it('defaults to "en" when profile language is en', async () => {
      const { wrapper } = mountSettings();
      await flushPromises();

      const select = wrapper.find<HTMLSelectElement>('select#language');
      expect(select.element.value).toBe('en');
    });
  });

  describe('language change behaviour', () => {
    it('calls changeLanguage with the selected language', async () => {
      const { wrapper } = mountSettings();
      await flushPromises();

      // Simulate selecting Spanish
      const select = wrapper.find('select#language');
      await select.setValue('es');
      await flushPromises();

      expect(localeService.changeLanguage).toHaveBeenCalledWith('es', expect.any(Function));
    });

    it('persists language to the API via the callback', async () => {
      let capturedCallback: ((language: string) => Promise<void>) | undefined;

      vi.spyOn(localeService, 'changeLanguage').mockImplementation(async (_lang, persistToApi) => {
        capturedCallback = persistToApi;
      });

      const updateLanguageFn = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(AccountService.prototype, 'updateLanguage').mockImplementation(updateLanguageFn);

      const { wrapper } = mountSettings();
      await flushPromises();

      const select = wrapper.find('select#language');
      await select.setValue('es');
      await flushPromises();

      // Invoke the captured API callback to verify it calls AccountService.updateLanguage
      expect(capturedCallback).toBeDefined();
      await capturedCallback!('es');

      expect(updateLanguageFn).toHaveBeenCalledWith('es', expect.anything());
    });

    it('does not use localStorage for language persistence', async () => {
      const localStorageSetSpy = vi.spyOn(Storage.prototype, 'setItem');

      const { wrapper } = mountSettings();
      await flushPromises();

      const select = wrapper.find('select#language');
      await select.setValue('es');
      await flushPromises();

      // Verify no localStorage writes happened for language/locale keys
      const langRelatedCalls = localStorageSetSpy.mock.calls.filter(
        ([key]) => key.toLowerCase().includes('lang') || key.toLowerCase().includes('locale'),
      );
      expect(langRelatedCalls).toHaveLength(0);
    });
  });

  describe('accessibility', () => {
    it('has a label associated with the select via for/id', async () => {
      const { wrapper } = mountSettings();
      await nextTick();

      const label = wrapper.find('label[for="language"]');
      expect(label.exists()).toBe(true);

      const select = wrapper.find('select#language');
      expect(select.exists()).toBe(true);
    });

    it('disables the select while the profile is loading', async () => {
      // Return a promise that never resolves so isLoading stays true
      vi.spyOn(AccountService.prototype, 'getProfile').mockReturnValue(new Promise(() => {}));

      const { wrapper } = mountSettings();
      await nextTick();

      const select = wrapper.find('select#language');
      expect(select.attributes('disabled')).toBeDefined();
    });

    it('enables the select after the profile is loaded', async () => {
      const { wrapper } = mountSettings();
      await flushPromises();

      const select = wrapper.find('select#language');
      expect(select.attributes('disabled')).toBeUndefined();
    });
  });
});
