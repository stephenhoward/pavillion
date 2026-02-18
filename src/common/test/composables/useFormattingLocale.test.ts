import { describe, it, expect, beforeEach } from 'vitest';
import { Settings } from 'luxon';
import { useFormattingLocale, resetFormattingLocaleState } from '@/common/composables/useFormattingLocale';

describe('useFormattingLocale', () => {
  beforeEach(() => {
    resetFormattingLocaleState();
  });

  describe('initialization', () => {
    it('should initialize with English as the default locale', () => {
      const { formattingLocale } = useFormattingLocale();

      expect(formattingLocale.value).toBe('en');
    });

    it('should initialize Luxon Settings.defaultLocale to English', () => {
      resetFormattingLocaleState();

      expect(Settings.defaultLocale).toBe('en');
    });
  });

  describe('setFormattingLocale', () => {
    it('should update the reactive formattingLocale ref', () => {
      const { formattingLocale, setFormattingLocale } = useFormattingLocale();

      setFormattingLocale('de');

      expect(formattingLocale.value).toBe('de');
    });

    it('should update Luxon Settings.defaultLocale', () => {
      const { setFormattingLocale } = useFormattingLocale();

      setFormattingLocale('fr');

      expect(Settings.defaultLocale).toBe('fr');
    });

    it('should support BCP 47 region subtags like en-US', () => {
      const { formattingLocale, setFormattingLocale } = useFormattingLocale();

      setFormattingLocale('en-US');

      expect(formattingLocale.value).toBe('en-US');
      expect(Settings.defaultLocale).toBe('en-US');
    });

    it('should support BCP 47 region subtags like de-DE', () => {
      const { formattingLocale, setFormattingLocale } = useFormattingLocale();

      setFormattingLocale('de-DE');

      expect(formattingLocale.value).toBe('de-DE');
      expect(Settings.defaultLocale).toBe('de-DE');
    });

    it('should support switching between locales', () => {
      const { formattingLocale, setFormattingLocale } = useFormattingLocale();

      setFormattingLocale('de');
      expect(formattingLocale.value).toBe('de');
      expect(Settings.defaultLocale).toBe('de');

      setFormattingLocale('ja');
      expect(formattingLocale.value).toBe('ja');
      expect(Settings.defaultLocale).toBe('ja');
    });

    it('should update all callers when locale changes (shared state)', () => {
      const instance1 = useFormattingLocale();
      const instance2 = useFormattingLocale();

      instance1.setFormattingLocale('es');

      expect(instance2.formattingLocale.value).toBe('es');
    });
  });

  describe('shared state across multiple useFormattingLocale() calls', () => {
    it('should share formattingLocale between different callers', () => {
      const caller1 = useFormattingLocale();
      const caller2 = useFormattingLocale();

      caller1.setFormattingLocale('pt');

      expect(caller1.formattingLocale.value).toBe('pt');
      expect(caller2.formattingLocale.value).toBe('pt');
    });

    it('should update Luxon once regardless of how many callers exist', () => {
      useFormattingLocale();
      useFormattingLocale();

      const { setFormattingLocale } = useFormattingLocale();
      setFormattingLocale('zh');

      expect(Settings.defaultLocale).toBe('zh');
    });
  });

  describe('integration with account effectiveFormattingLocale', () => {
    it('should accept a locale derived from account language when formattingLocale is null', () => {
      // Simulates Account.effectiveFormattingLocale when formattingLocale is null (falls back to language)
      const effectiveLocale = 'es'; // account.formattingLocale ?? account.language
      const { formattingLocale, setFormattingLocale } = useFormattingLocale();

      setFormattingLocale(effectiveLocale);

      expect(formattingLocale.value).toBe('es');
      expect(Settings.defaultLocale).toBe('es');
    });

    it('should accept an explicitly set formatting locale that differs from UI language', () => {
      // Simulates an account with UI language='en' but formattingLocale='de'
      const effectiveLocale = 'de';
      const { formattingLocale, setFormattingLocale } = useFormattingLocale();

      setFormattingLocale(effectiveLocale);

      expect(formattingLocale.value).toBe('de');
      expect(Settings.defaultLocale).toBe('de');
    });
  });

  describe('resetFormattingLocaleState', () => {
    it('should reset formattingLocale to English', () => {
      const { formattingLocale, setFormattingLocale } = useFormattingLocale();

      setFormattingLocale('de');
      expect(formattingLocale.value).toBe('de');

      resetFormattingLocaleState();

      expect(formattingLocale.value).toBe('en');
    });

    it('should reset Luxon Settings.defaultLocale to English', () => {
      const { setFormattingLocale } = useFormattingLocale();

      setFormattingLocale('ja');
      expect(Settings.defaultLocale).toBe('ja');

      resetFormattingLocaleState();

      expect(Settings.defaultLocale).toBe('en');
    });
  });
});
