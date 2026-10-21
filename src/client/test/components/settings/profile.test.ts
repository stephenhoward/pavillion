import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { mountComponent } from '@/client/test/lib/vue';
import ProfileSettings from '@/client/components/logged_in/settings/profile.vue';
import AccountService from '@/client/service/account';
import * as localeService from '@/client/service/locale';
import { AVAILABLE_LANGUAGES } from '@/common/i18n/languages';
import { Account } from '@/common/model/account';

const routes: RouteRecordRaw[] = [
  { path: '/settings/account/profile', component: {}, name: 'profile' },
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
 * Mount the profile leaf with a logged-in, non-admin viewer.
 */
function mountProfile() {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  const wrapper = mountComponent(ProfileSettings, router, {
    provide: {
      authn: {
        isAdmin: () => false,
        userEmail: () => 'test@example.com',
      },
    },
  });

  return { wrapper, router };
}

describe('Profile settings leaf', () => {
  beforeEach(() => {
    vi.spyOn(AccountService.prototype, 'getProfile').mockResolvedValue(buildProfile('en'));
    vi.spyOn(AccountService.prototype, 'updateLanguage').mockResolvedValue(undefined);
    vi.spyOn(localeService, 'changeLanguage').mockResolvedValue(undefined);
    vi.spyOn(localeService, 'applyAccountLanguage').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('profile fields', () => {
    it('shows the loaded display name and read-only username', async () => {
      const { wrapper } = mountProfile();
      await flushPromises();

      const input = wrapper.find<HTMLInputElement>('input#display-name');
      expect(input.element.value).toBe('Test User');

      const username = wrapper.find('[role="group"][aria-labelledby="username-label"]');
      expect(username.exists()).toBe(true);
      expect(username.text()).toContain('testuser');
    });

    it('applies the account language after loading the profile', async () => {
      vi.spyOn(AccountService.prototype, 'getProfile').mockResolvedValue(buildProfile('fr'));
      mountProfile();
      await flushPromises();

      expect(localeService.applyAccountLanguage).toHaveBeenCalledWith('fr');
    });

    it('saves the display name on blur and announces success', async () => {
      const save = vi.spyOn(AccountService.prototype, 'updateProfile').mockResolvedValue(buildProfile('en'));
      const { wrapper } = mountProfile();
      await flushPromises();

      const input = wrapper.find('input#display-name');
      await input.setValue('New Name');
      await input.trigger('blur');
      await flushPromises();

      expect(save).toHaveBeenCalledWith('New Name');
      expect(wrapper.find('[role="status"]').text()).toBe('Display name saved');
      expect(wrapper.find('[role="alert"]').text()).toBe('');
    });

    it('announces a failed save through the alert region, not the status region', async () => {
      vi.spyOn(AccountService.prototype, 'updateProfile').mockRejectedValue(new Error('network'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { wrapper } = mountProfile();
      await flushPromises();

      await wrapper.find('input#display-name').trigger('blur');
      await flushPromises();

      expect(wrapper.find('[role="alert"]').text()).toBe('Error saving display name');
      expect(wrapper.find('[role="status"]').text()).toBe('');
    });

    it('clears a previous error from the alert region when a later save succeeds', async () => {
      const save = vi.spyOn(AccountService.prototype, 'updateProfile').mockRejectedValue(new Error('network'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { wrapper } = mountProfile();
      await flushPromises();

      const input = wrapper.find('input#display-name');
      await input.trigger('blur');
      await flushPromises();

      save.mockResolvedValue(buildProfile('en'));
      await input.trigger('blur');
      await flushPromises();

      expect(wrapper.find('[role="alert"]').text()).toBe('');
      expect(wrapper.find('[role="status"]').text()).toBe('Display name saved');
    });

    it('keeps both live regions in the accessibility tree before anything is announced', async () => {
      const { wrapper } = mountProfile();
      await flushPromises();

      for (const role of ['status', 'alert']) {
        const region = wrapper.find(`[role="${role}"]`);
        expect(region.exists()).toBe(true);
        expect(region.text()).toBe('');
        expect(region.attributes('aria-hidden')).toBeUndefined();
      }
    });

    it('hides the decorative @ before the username from assistive technology', async () => {
      const { wrapper } = mountProfile();
      await flushPromises();

      const group = wrapper.find('[role="group"][aria-labelledby="username-label"]');
      const at = group.findAll('span').find(s => s.text() === '@');
      expect(at?.attributes('aria-hidden')).toBe('true');
    });
  });

  describe('dropdown population', () => {
    it('renders a language select element', async () => {
      const { wrapper } = mountProfile();
      await nextTick();

      expect(wrapper.find('select#language').exists()).toBe(true);
    });

    it('populates options from AVAILABLE_LANGUAGES', async () => {
      const { wrapper } = mountProfile();
      await nextTick();

      const options = wrapper.findAll('select#language option');
      expect(options.length).toBe(AVAILABLE_LANGUAGES.length);
    });

    it('uses nativeName as the option display text', async () => {
      const { wrapper } = mountProfile();
      await nextTick();

      const optionTexts = wrapper.findAll('select#language option').map(o => o.text());
      for (const lang of AVAILABLE_LANGUAGES) {
        expect(optionTexts).toContain(lang.nativeName);
      }
    });

    it('uses language code as the option value', async () => {
      const { wrapper } = mountProfile();
      await nextTick();

      const optionValues = wrapper.findAll('select#language option').map(o => o.attributes('value'));
      for (const lang of AVAILABLE_LANGUAGES) {
        expect(optionValues).toContain(lang.code);
      }
    });
  });

  describe('initial value', () => {
    it('reflects the language loaded from the user profile', async () => {
      vi.spyOn(AccountService.prototype, 'getProfile').mockResolvedValue(buildProfile('es'));

      const { wrapper } = mountProfile();
      await flushPromises();

      expect(wrapper.find<HTMLSelectElement>('select#language').element.value).toBe('es');
    });

    it('defaults to "en" when profile language is en', async () => {
      const { wrapper } = mountProfile();
      await flushPromises();

      expect(wrapper.find<HTMLSelectElement>('select#language').element.value).toBe('en');
    });
  });

  describe('language change behaviour', () => {
    it('calls changeLanguage with the selected language', async () => {
      const { wrapper } = mountProfile();
      await flushPromises();

      await wrapper.find('select#language').setValue('es');
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

      const { wrapper } = mountProfile();
      await flushPromises();

      await wrapper.find('select#language').setValue('es');
      await flushPromises();

      expect(capturedCallback).toBeDefined();
      await capturedCallback!('es');
      expect(updateLanguageFn).toHaveBeenCalledWith('es');
    });

    it('does not use localStorage for language persistence', async () => {
      const localStorageSetSpy = vi.spyOn(Storage.prototype, 'setItem');

      const { wrapper } = mountProfile();
      await flushPromises();

      await wrapper.find('select#language').setValue('es');
      await flushPromises();

      const langRelatedCalls = localStorageSetSpy.mock.calls.filter(
        ([key]) => key.toLowerCase().includes('lang') || key.toLowerCase().includes('locale'),
      );
      expect(langRelatedCalls).toHaveLength(0);
    });
  });

  describe('accessibility', () => {
    it('has a label associated with the select via for/id', async () => {
      const { wrapper } = mountProfile();
      await nextTick();

      expect(wrapper.find('label[for="language"]').exists()).toBe(true);
      expect(wrapper.find('select#language').exists()).toBe(true);
    });

    it('disables the select while the profile is loading', async () => {
      vi.spyOn(AccountService.prototype, 'getProfile').mockReturnValue(new Promise(() => {}));

      const { wrapper } = mountProfile();
      await nextTick();

      expect(wrapper.find('select#language').attributes('disabled')).toBeDefined();
    });

    it('enables the select after the profile is loaded', async () => {
      const { wrapper } = mountProfile();
      await flushPromises();

      expect(wrapper.find('select#language').attributes('disabled')).toBeUndefined();
    });

    it('clears loading and enables the fields when the profile fails to load', async () => {
      vi.spyOn(AccountService.prototype, 'getProfile').mockRejectedValue(new Error('network'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const { wrapper } = mountProfile();
      await flushPromises();

      expect(wrapper.find('select#language').attributes('disabled')).toBeUndefined();
      expect(wrapper.find('input#display-name').attributes('disabled')).toBeUndefined();
    });

    it('keeps the Preferences heading but does not repeat the layout title', async () => {
      const { wrapper } = mountProfile();
      await flushPromises();

      const headings = wrapper.findAll('h1, h2').map(h => h.text());
      expect(headings).toEqual(['PREFERENCES']);
    });
  });

  describe('scope of the leaf', () => {
    it('carries no funding card, logout control or inline svg', async () => {
      const { wrapper } = mountProfile();
      await flushPromises();

      expect(wrapper.find('.funding-card').exists()).toBe(false);
      expect(wrapper.find('.logout-button').exists()).toBe(false);
      expect(wrapper.find('svg').exists()).toBe(false);
    });
  });
});
