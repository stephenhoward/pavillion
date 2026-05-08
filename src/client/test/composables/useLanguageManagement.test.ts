import { describe, it, expect, vi } from 'vitest';
import { useLanguageManagement } from '@/client/composables/useLanguageManagement';

// Mock iso-639-1-dir package — frozen list keeps assertions deterministic
// without coupling to the real package's evolving code list.
vi.mock('iso-639-1-dir', () => ({
  default: {
    getAllCodes: () => ['en', 'fr', 'es', 'de', 'it', 'pt', 'ja', 'zh', 'ru', 'ar', 'hi'],
  },
}));

describe('useLanguageManagement', () => {
  describe('initialization', () => {
    it('should initialize with default language (en)', () => {
      const { languages, currentLanguage } = useLanguageManagement();

      expect(languages.value).toEqual(['en']);
      expect(currentLanguage.value).toBe('en');
    });

    it('should initialize with language picker modal closed', () => {
      const { showLanguagePicker } = useLanguageManagement();

      expect(showLanguagePicker.value).toBe(false);
    });

    it('should provide list of available languages', () => {
      const { availableLanguages } = useLanguageManagement();

      // Mock provides 11 codes; 'en' is active, so 10 remain available.
      expect(availableLanguages.value.length).toBe(10);
    });

    it('should have no duplicate languages in availableLanguages', () => {
      const { availableLanguages } = useLanguageManagement();

      const uniqueLanguages = [...new Set(availableLanguages.value)];
      expect(availableLanguages.value).toEqual(uniqueLanguages);
    });
  });

  describe('initialLanguages factory', () => {
    it('should honor factory at construction', () => {
      const { languages } = useLanguageManagement({
        initialLanguages: () => ['en', 'fr'],
      });

      expect(languages.value).toEqual(['en', 'fr']);
    });

    it('should call factory exactly once at construction', () => {
      const factory = vi.fn(() => ['en', 'es']);
      const { languages } = useLanguageManagement({ initialLanguages: factory });

      expect(factory).toHaveBeenCalledTimes(1);

      // Reading languages after construction must not re-invoke factory
      void languages.value;
      void languages.value;

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('should default to [DEFAULT_LANGUAGE_CODE] when no factory provided', () => {
      const { languages } = useLanguageManagement();

      expect(languages.value).toEqual(['en']);
    });

    it('should set currentLanguage to first language from factory', () => {
      const { currentLanguage } = useLanguageManagement({
        initialLanguages: () => ['fr', 'en'],
      });

      expect(currentLanguage.value).toBe('fr');
    });
  });

  describe('addLanguage', () => {
    it('should add language to languages list', () => {
      const { languages, addLanguage } = useLanguageManagement();

      addLanguage('fr');

      expect(languages.value).toContain('fr');
      expect(languages.value).toContain('en'); // Should preserve existing
    });

    it('should set added language as current language', () => {
      const { currentLanguage, addLanguage } = useLanguageManagement();

      addLanguage('fr');

      expect(currentLanguage.value).toBe('fr');
    });

    it('should not duplicate languages when adding same language twice', () => {
      const { languages, addLanguage } = useLanguageManagement();

      addLanguage('fr');
      addLanguage('fr');

      const frCount = languages.value.filter((l: string) => l === 'fr').length;
      expect(frCount).toBe(1);
    });

    it('should handle adding multiple different languages', () => {
      const { languages, addLanguage } = useLanguageManagement();

      addLanguage('fr');
      addLanguage('es');
      addLanguage('de');

      expect(languages.value).toContain('en');
      expect(languages.value).toContain('fr');
      expect(languages.value).toContain('es');
      expect(languages.value).toContain('de');
    });

    it('should invoke onLanguageAdded with the added lang', () => {
      const onLanguageAdded = vi.fn();
      const { addLanguage } = useLanguageManagement({ onLanguageAdded });

      addLanguage('fr');

      expect(onLanguageAdded).toHaveBeenCalledTimes(1);
      expect(onLanguageAdded).toHaveBeenCalledWith('fr');
    });

    it('should be a no-op for the hook when onLanguageAdded is undefined', () => {
      const { languages, addLanguage } = useLanguageManagement();

      // No hook supplied; addLanguage must not throw and state must update
      expect(() => addLanguage('fr')).not.toThrow();
      expect(languages.value).toContain('fr');
    });
  });

  describe('removeLanguage', () => {
    it('should remove language from languages list', () => {
      const { languages, removeLanguage } = useLanguageManagement({
        initialLanguages: () => ['en', 'fr', 'es'],
      });

      removeLanguage('fr');

      expect(languages.value).not.toContain('fr');
      expect(languages.value).toContain('en');
      expect(languages.value).toContain('es');
    });

    it('should invoke onLanguageRemoved hook with correct lang', () => {
      const onLanguageRemoved = vi.fn();
      const { removeLanguage } = useLanguageManagement({
        initialLanguages: () => ['en', 'fr'],
        onLanguageRemoved,
      });

      removeLanguage('fr');

      expect(onLanguageRemoved).toHaveBeenCalledTimes(1);
      expect(onLanguageRemoved).toHaveBeenCalledWith('fr');
    });

    it('should switch to first available language after removal', () => {
      const { currentLanguage, removeLanguage } = useLanguageManagement({
        initialLanguages: () => ['en', 'fr', 'es'],
      });

      removeLanguage('fr');

      // First remaining language is 'en'
      expect(currentLanguage.value).toBe('en');
    });

    it('should switch current language if removing the current one', () => {
      const { currentLanguage, removeLanguage, addLanguage } = useLanguageManagement();

      // addLanguage sets current to 'fr'
      addLanguage('fr');
      expect(currentLanguage.value).toBe('fr');

      // Remove French (current language)
      removeLanguage('fr');

      // Should switch to first remaining language (en)
      expect(currentLanguage.value).toBe('en');
    });

    it('should not invoke hook when removing non-existent language', () => {
      const onLanguageRemoved = vi.fn();
      const { languages, removeLanguage } = useLanguageManagement({
        initialLanguages: () => ['en', 'fr'],
        onLanguageRemoved,
      });
      const originalCount = languages.value.length;

      removeLanguage('de'); // 'de' is not in the active list

      expect(languages.value.length).toBe(originalCount);
      expect(onLanguageRemoved).not.toHaveBeenCalled();
    });

    it('should be a no-op for the hook when onLanguageRemoved is undefined', () => {
      const { languages, removeLanguage } = useLanguageManagement({
        initialLanguages: () => ['en', 'fr'],
      });

      // No hook supplied; must not throw and must still mutate state
      expect(() => removeLanguage('fr')).not.toThrow();
      expect(languages.value).not.toContain('fr');
    });
  });

  describe('currentLanguage state', () => {
    it('should update when adding a language', () => {
      const { currentLanguage, addLanguage } = useLanguageManagement();

      expect(currentLanguage.value).toBe('en');

      addLanguage('fr');

      expect(currentLanguage.value).toBe('fr');
    });

    it('should be reactive to manual updates', () => {
      const { currentLanguage } = useLanguageManagement();

      currentLanguage.value = 'es';

      expect(currentLanguage.value).toBe('es');
    });

    it('should maintain state when removing other languages', () => {
      const { currentLanguage, removeLanguage } = useLanguageManagement({
        initialLanguages: () => ['en', 'fr', 'es'],
      });

      // Current is 'en' by default (first language from factory)
      expect(currentLanguage.value).toBe('en');

      // Remove a different language
      removeLanguage('fr');

      // Current should still be 'en'
      expect(currentLanguage.value).toBe('en');
    });
  });

  describe('language picker modal state', () => {
    it('should open language picker modal', () => {
      const { showLanguagePicker, openLanguagePicker } = useLanguageManagement();

      expect(showLanguagePicker.value).toBe(false);

      openLanguagePicker();

      expect(showLanguagePicker.value).toBe(true);
    });

    it('should close language picker modal', () => {
      const { showLanguagePicker, openLanguagePicker, closeLanguagePicker } = useLanguageManagement();

      openLanguagePicker();
      expect(showLanguagePicker.value).toBe(true);

      closeLanguagePicker();

      expect(showLanguagePicker.value).toBe(false);
    });

    it('should allow multiple open/close cycles', () => {
      const { showLanguagePicker, openLanguagePicker, closeLanguagePicker } = useLanguageManagement();

      openLanguagePicker();
      expect(showLanguagePicker.value).toBe(true);

      closeLanguagePicker();
      expect(showLanguagePicker.value).toBe(false);

      openLanguagePicker();
      expect(showLanguagePicker.value).toBe(true);

      closeLanguagePicker();
      expect(showLanguagePicker.value).toBe(false);
    });

    it('should handle closing when already closed', () => {
      const { showLanguagePicker, closeLanguagePicker } = useLanguageManagement();

      expect(showLanguagePicker.value).toBe(false);

      closeLanguagePicker();

      expect(showLanguagePicker.value).toBe(false);
    });

    it('should handle opening when already open', () => {
      const { showLanguagePicker, openLanguagePicker } = useLanguageManagement();

      openLanguagePicker();
      expect(showLanguagePicker.value).toBe(true);

      openLanguagePicker();

      expect(showLanguagePicker.value).toBe(true);
    });
  });

  describe('available languages list', () => {
    it('should include common language codes (excluding active)', () => {
      const { availableLanguages } = useLanguageManagement();

      // 'en' is active and therefore excluded; the rest of the common
      // ISO codes should still be available.
      const commonLanguages = ['fr', 'es', 'de', 'it', 'pt', 'ja', 'zh', 'ru'];

      for (const lang of commonLanguages) {
        expect(availableLanguages.value).toContain(lang);
      }
    });

    it('should reactively exclude active languages from availableLanguages', () => {
      const { languages, availableLanguages } = useLanguageManagement();

      // 'en' is active; should be excluded from available
      expect(availableLanguages.value).not.toContain('en');
      expect(availableLanguages.value).toContain('fr');

      // Mutate languages directly — composable contract allows this
      languages.value = ['en', 'fr'];

      // Now 'fr' is also active and must be excluded
      expect(availableLanguages.value).not.toContain('en');
      expect(availableLanguages.value).not.toContain('fr');
      expect(availableLanguages.value).toContain('es');
    });

    it('should NOT include the default language when it is active', () => {
      const { availableLanguages } = useLanguageManagement();

      // Default state has 'en' active, so 'en' is excluded from available
      expect(availableLanguages.value).not.toContain('en');
    });
  });

  describe('edge cases', () => {
    it('should be a no-op when removing the last language (length 1 guard)', () => {
      const onLanguageRemoved = vi.fn();
      const { languages, currentLanguage, removeLanguage } = useLanguageManagement({
        initialLanguages: () => ['en'],
        onLanguageRemoved,
      });

      removeLanguage('en');

      // Languages must remain unchanged
      expect(languages.value).toEqual(['en']);
      // Current language must remain unchanged
      expect(currentLanguage.value).toBe('en');
      // Hook MUST NOT be invoked under the guard
      expect(onLanguageRemoved).not.toHaveBeenCalled();
    });

    it('should fall back to first remaining language when removing a non-default language', () => {
      const { languages, currentLanguage, removeLanguage, addLanguage } = useLanguageManagement();

      // Add and switch to French (now ['en', 'fr'], current='fr')
      addLanguage('fr');

      // Remove the default 'en' — composable falls back to first remaining language
      removeLanguage('en');

      expect(languages.value).toEqual(['fr']);
      expect(currentLanguage.value).toBe('fr');
    });
  });
});
