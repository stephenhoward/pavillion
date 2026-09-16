import { describe, it, expect } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import ImageAltEditor from '@/client/components/common/media/ImageAltEditor.vue';
import { EventSeries } from '@/common/model/event_series';
import { mountComponent } from '@/client/test/lib/vue';

/**
 * Tests for ImageAltEditor.
 *
 * The component's contract is the parent's working model: it seeds its mode
 * from the model, writes alt text straight onto it, and — because "decorative"
 * is stored as the absence of alt text — clears the model when the author
 * chooses Decorative. The stash that makes that clearing reversible is the
 * bulk of what is exercised here.
 */

/**
 * Builds a series whose languages carry the supplied alt text.
 *
 * @param {Record<string, string>} alts - Alt text keyed by language code
 * @returns {EventSeries} A series with one content row per supplied language
 */
const seriesWithAlts = (alts: Record<string, string>): EventSeries => {
  const series = new EventSeries('series-1', 'calendar-1', 'summer-series');
  for (const [language, imageAlt] of Object.entries(alts)) {
    const content = series.content(language);
    content.name = `Name (${language})`;
    content.imageAlt = imageAlt;
  }
  return series;
};

const mountEditor = (model: EventSeries, language = 'en', disabled = false) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [],
  });

  return mountComponent(ImageAltEditor, router, {
    props: { model, language, disabled },
  });
};

const decorativeRadio = (wrapper: any) => wrapper.findAll('input[type="radio"]')[0];
const describeRadio = (wrapper: any) => wrapper.findAll('input[type="radio"]')[1];

describe('ImageAltEditor', () => {

  describe('seeding the mode from the model', () => {

    it('starts decorative and hides the textarea when no language has alt text', () => {
      const wrapper = mountEditor(seriesWithAlts({ en: '', fr: '' }));

      expect((decorativeRadio(wrapper).element as HTMLInputElement).checked).toBe(true);
      expect((describeRadio(wrapper).element as HTMLInputElement).checked).toBe(false);
      expect(wrapper.find('textarea').exists()).toBe(false);
    });

    it('starts describing when any language has alt text, even another one', () => {
      const wrapper = mountEditor(seriesWithAlts({ en: '', fr: 'Une affiche' }), 'en');

      expect((describeRadio(wrapper).element as HTMLInputElement).checked).toBe(true);
      expect(wrapper.find('textarea').exists()).toBe(true);
    });

    it('re-seeds and drops the stash when the model identity changes', async () => {
      const wrapper = mountEditor(seriesWithAlts({ en: 'A poster' }));

      await decorativeRadio(wrapper).trigger('change');
      expect(wrapper.find('.alert--warning').exists()).toBe(true);

      await wrapper.setProps({ model: seriesWithAlts({ en: 'A different poster' }) });

      expect((describeRadio(wrapper).element as HTMLInputElement).checked).toBe(true);
      expect(wrapper.find('.alert--warning').exists()).toBe(false);
      expect((wrapper.find('textarea').element as HTMLTextAreaElement).value)
        .toBe('A different poster');
    });
  });

  describe('the description field', () => {

    it('binds the textarea to the current language and caps it at 500 characters', async () => {
      const model = seriesWithAlts({ en: 'A poster', fr: 'Une affiche' });
      const wrapper = mountEditor(model, 'en');

      const textarea = wrapper.find('textarea');
      expect((textarea.element as HTMLTextAreaElement).value).toBe('A poster');
      expect(textarea.attributes('maxlength')).toBe('500');

      await textarea.setValue('A poster for the summer series');
      expect(model.content('en').imageAlt).toBe('A poster for the summer series');
      expect(model.content('fr').imageAlt).toBe('Une affiche');
    });

    it('rebinds to the new language when the language prop changes', async () => {
      const model = seriesWithAlts({ en: 'A poster', fr: 'Une affiche' });
      const wrapper = mountEditor(model, 'en');

      await wrapper.setProps({ language: 'fr' });

      expect((wrapper.find('textarea').element as HTMLTextAreaElement).value)
        .toBe('Une affiche');

      await wrapper.find('textarea').setValue('Une affiche colorée');
      expect(model.content('fr').imageAlt).toBe('Une affiche colorée');
      expect(model.content('en').imageAlt).toBe('A poster');
    });

    it('names the language being described in the field label', () => {
      const wrapper = mountEditor(seriesWithAlts({ fr: 'Une affiche' }), 'fr');

      expect(wrapper.find('label[for]').text()).toContain('French');
    });

    it('disables the controls when the disabled prop is set', () => {
      const wrapper = mountEditor(seriesWithAlts({ en: 'A poster' }), 'en', true);

      expect(wrapper.find('fieldset').attributes('disabled')).toBeDefined();
      expect(wrapper.find('textarea').attributes('disabled')).toBeDefined();
    });
  });

  describe('switching to decorative', () => {

    it('clears every language on the model, not only the one being shown', async () => {
      const model = seriesWithAlts({ en: 'A poster', fr: 'Une affiche' });
      const wrapper = mountEditor(model, 'en');

      await decorativeRadio(wrapper).trigger('change');

      expect(model.content('en').imageAlt).toBe('');
      expect(model.content('fr').imageAlt).toBe('');
      expect(wrapper.find('textarea').exists()).toBe(false);
    });

    it('warns that the descriptions will be removed on save', async () => {
      const wrapper = mountEditor(seriesWithAlts({ en: 'A poster' }), 'en');

      expect(wrapper.find('.alert--warning').exists()).toBe(false);

      await decorativeRadio(wrapper).trigger('change');

      expect(wrapper.find('.alert.alert--warning').text()).toContain('removed when you save');
    });

    it('shows no warning when there was no description to lose', async () => {
      const model = seriesWithAlts({ en: '' });
      const wrapper = mountEditor(model, 'en');

      await describeRadio(wrapper).trigger('change');
      await decorativeRadio(wrapper).trigger('change');

      expect(wrapper.find('.alert--warning').exists()).toBe(false);
    });
  });

  describe('switching back to describing', () => {

    it('restores every stashed language and clears the stash', async () => {
      const model = seriesWithAlts({ en: 'A poster', fr: 'Une affiche' });
      const wrapper = mountEditor(model, 'en');

      await decorativeRadio(wrapper).trigger('change');
      await describeRadio(wrapper).trigger('change');

      expect(model.content('en').imageAlt).toBe('A poster');
      expect(model.content('fr').imageAlt).toBe('Une affiche');
      expect(wrapper.find('.alert--warning').exists()).toBe(false);
    });

    it('does not restore into a language removed while decorative', async () => {
      const model = seriesWithAlts({ en: 'A poster', fr: 'Une affiche' });
      const wrapper = mountEditor(model, 'en');

      await decorativeRadio(wrapper).trigger('change');
      model.dropContent('fr');
      await describeRadio(wrapper).trigger('change');

      expect(model.getLanguages()).toEqual(['en']);
      expect(model.content('en').imageAlt).toBe('A poster');
    });

    it('drops the restored text for good once the stash is spent', async () => {
      const model = seriesWithAlts({ en: 'A poster' });
      const wrapper = mountEditor(model, 'en');

      await decorativeRadio(wrapper).trigger('change');
      await describeRadio(wrapper).trigger('change');
      await wrapper.find('textarea').setValue('');
      await decorativeRadio(wrapper).trigger('change');
      await describeRadio(wrapper).trigger('change');

      expect(model.content('en').imageAlt).toBe('');
    });
  });
});
