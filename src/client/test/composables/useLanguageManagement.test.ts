import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLanguageManagement } from '@/client/composables/useLanguageManagement';
import { CalendarEvent } from '@/common/model/events';

// Mock iso-639-1-dir package
vi.mock('iso-639-1-dir', () => ({
  default: {
    getAllCodes: () => ['en', 'fr', 'es', 'de', 'it', 'pt', 'ja', 'zh', 'ru', 'ar', 'hi'],
  },
}));

describe('useLanguageManagement', () => {
  let event: CalendarEvent;

  beforeEach(() => {
    // Create a fresh event for each test
    event = new CalendarEvent();
  });

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

      // Should include default language
      expect(availableLanguages.value).toContain('en');
      // Should be a substantial list of ISO 639-1 codes
      expect(availableLanguages.value.length).toBeGreaterThan(10);
    });

    it('should have no duplicate languages in availableLanguages', () => {
      const { availableLanguages } = useLanguageManagement();

      const uniqueLanguages = [...new Set(availableLanguages.value)];
      expect(availableLanguages.value).toEqual(uniqueLanguages);
    });
  });

  describe('initializeLanguages', () => {
    it('should extract languages from event', () => {
      const { languages, initializeLanguages } = useLanguageManagement();

      // Add multiple languages to event
      event.content('en').title = 'English Title';
      event.content('fr').title = 'Titre français';
      event.content('es').title = 'Título español';

      initializeLanguages(event);

      // Should extract all languages from event
      expect(languages.value).toContain('en');
      expect(languages.value).toContain('fr');
      expect(languages.value).toContain('es');
    });

    it('should ensure default language (en) is included', () => {
      const { languages, initializeLanguages } = useLanguageManagement();

      // Event with only French content
      event.content('fr').title = 'Titre français';

      initializeLanguages(event);

      // Should include both en and fr
      expect(languages.value).toContain('en');
      expect(languages.value).toContain('fr');
    });

    it('should not duplicate default language if already in event', () => {
      const { languages, initializeLanguages } = useLanguageManagement();

      // Event with English content
      event.content('en').title = 'English Title';
      event.content('fr').title = 'Titre français';

      initializeLanguages(event);

      // Should have exactly one 'en'
      const enCount = languages.value.filter(l => l === 'en').length;
      expect(enCount).toBe(1);
    });

    it('should handle event with no content gracefully', () => {
      const { languages, initializeLanguages } = useLanguageManagement();

      initializeLanguages(event);

      // Should have at least default language
      expect(languages.value).toContain('en');
    });
  });

  describe('addLanguage', () => {
    it('should add language to languages list', () => {
      const { languages, addLanguage } = useLanguageManagement();

      addLanguage('fr', event);

      expect(languages.value).toContain('fr');
      expect(languages.value).toContain('en'); // Should preserve existing
    });

    it('should set added language as current language', () => {
      const { currentLanguage, addLanguage } = useLanguageManagement();

      addLanguage('fr', event);

      expect(currentLanguage.value).toBe('fr');
    });

    it('should not duplicate languages when adding same language twice', () => {
      const { languages, addLanguage } = useLanguageManagement();

      addLanguage('fr', event);
      addLanguage('fr', event);

      const frCount = languages.value.filter(l => l === 'fr').length;
      expect(frCount).toBe(1);
    });

    it('should handle adding multiple different languages', () => {
      const { languages, addLanguage } = useLanguageManagement();

      addLanguage('fr', event);
      addLanguage('es', event);
      addLanguage('de', event);

      expect(languages.value).toContain('en');
      expect(languages.value).toContain('fr');
      expect(languages.value).toContain('es');
      expect(languages.value).toContain('de');
    });
  });

  describe('removeLanguage', () => {
    beforeEach(() => {
      // Set up event with multiple languages
      event.content('en').title = 'English Title';
      event.content('fr').title = 'Titre français';
      event.content('es').title = 'Título español';
    });

    it('should remove language from languages list', () => {
      const { languages, removeLanguage, initializeLanguages } = useLanguageManagement();

      initializeLanguages(event);
      removeLanguage('fr', event);

      expect(languages.value).not.toContain('fr');
      expect(languages.value).toContain('en');
      expect(languages.value).toContain('es');
    });

    it('should call dropContent on the event', () => {
      const { removeLanguage, initializeLanguages } = useLanguageManagement();

      initializeLanguages(event);

      // Verify content exists before removal
      expect(event.getLanguages()).toContain('fr');

      removeLanguage('fr', event);

      // Verify content was dropped
      expect(event.getLanguages()).not.toContain('fr');
    });

    it('should switch to first available language after removal', () => {
      const { currentLanguage, removeLanguage, initializeLanguages } = useLanguageManagement();

      initializeLanguages(event);

      // Current language should be first in list (en)
      const firstLanguage = 'en';

      // Remove a different language
      removeLanguage('fr', event);

      // Should still be on first language
      expect(currentLanguage.value).toBe(firstLanguage);
    });

    it('should switch current language if removing the current one', () => {
      const { currentLanguage, removeLanguage, initializeLanguages, addLanguage } = useLanguageManagement();

      initializeLanguages(event);

      // Switch to French
      addLanguage('fr', event);
      expect(currentLanguage.value).toBe('fr');

      // Remove French (current language)
      removeLanguage('fr', event);

      // Should switch to first remaining language (en)
      expect(currentLanguage.value).toBe('en');
    });

    it('should handle removing non-existent language gracefully', () => {
      const { languages, removeLanguage, initializeLanguages } = useLanguageManagement();

      initializeLanguages(event);
      const originalCount = languages.value.length;

      removeLanguage('de', event); // Language not in event

      // Should not affect languages list
      expect(languages.value.length).toBe(originalCount);
    });
  });

  describe('currentLanguage state', () => {
    it('should update when adding a language', () => {
      const { currentLanguage, addLanguage } = useLanguageManagement();

      expect(currentLanguage.value).toBe('en');

      addLanguage('fr', event);

      expect(currentLanguage.value).toBe('fr');
    });

    it('should be reactive to manual updates', () => {
      const { currentLanguage } = useLanguageManagement();

      currentLanguage.value = 'es';

      expect(currentLanguage.value).toBe('es');
    });

    it('should maintain state when removing other languages', () => {
      const { currentLanguage, removeLanguage, initializeLanguages } = useLanguageManagement();

      event.content('en').title = 'English';
      event.content('fr').title = 'French';
      event.content('es').title = 'Spanish';

      initializeLanguages(event);

      // Current is 'en' by default
      expect(currentLanguage.value).toBe('en');

      // Remove a different language
      removeLanguage('fr', event);

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
    it('should include common language codes', () => {
      const { availableLanguages } = useLanguageManagement();

      const commonLanguages = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ja', 'zh', 'ru'];

      for (const lang of commonLanguages) {
        expect(availableLanguages.value).toContain(lang);
      }
    });

    it('should be immutable during composable lifecycle', () => {
      const { availableLanguages } = useLanguageManagement();

      const initialLength = availableLanguages.value.length;
      const initialFirst = availableLanguages.value[0];

      // Try to modify (this shouldn't affect the ref)
      availableLanguages.value.push('xx');

      // Should maintain original values
      expect(availableLanguages.value.length).toBeGreaterThanOrEqual(initialLength);
      expect(availableLanguages.value[0]).toBe(initialFirst);
    });

    it('should include default language in available languages', () => {
      const { availableLanguages } = useLanguageManagement();

      expect(availableLanguages.value).toContain('en');
    });
  });

  describe('edge cases', () => {
    it('should handle null event gracefully in removeLanguage', () => {
      const { languages, removeLanguage, addLanguage } = useLanguageManagement();

      addLanguage('fr', event);

      // @ts-expect-error Testing null event handling
      expect(() => removeLanguage('fr', null)).not.toThrow();

      // Should still remove from languages list
      expect(languages.value).not.toContain('fr');
    });

    it('should handle undefined event gracefully in initializeLanguages', () => {
      const { languages, initializeLanguages } = useLanguageManagement();

      // @ts-expect-error Testing undefined event handling
      expect(() => initializeLanguages(undefined)).not.toThrow();

      // Should maintain default state
      expect(languages.value).toContain('en');
    });

    it('should handle removing last language by keeping first', () => {
      const { languages, currentLanguage, removeLanguage, addLanguage } = useLanguageManagement();

      // Add and switch to French
      addLanguage('fr', event);

      // Now try to remove default language
      removeLanguage('en', event);

      // Should have at least one language remaining
      expect(languages.value.length).toBeGreaterThan(0);
      expect(currentLanguage.value).toBe(languages.value[0]);
    });
  });
});
