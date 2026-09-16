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

/**
 * Builds a series in which a language carries alt text and nothing else. The
 * shared helper above always writes a name, which makes every row non-empty and
 * hides the difference between the two membership tests the restore path could
 * use.
 *
 * @param {string} language - The language whose only populated field is alt text
 * @param {string} imageAlt - The alt text to place on that language
 * @returns {EventSeries} A series with a named English row and an alt-only row
 */
const seriesWithAltOnlyLanguage = (language: string, imageAlt: string): EventSeries => {
  const series = seriesWithAlts({ en: 'A poster' });
  series.content(language).imageAlt = imageAlt;
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

      expect(wrapper.find('.form-field label').text()).toContain('French');
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

    it('restores a language whose only content was the alt text just cleared', async () => {
      // Pins the restore guard's membership test to getLanguages() and rules
      // out the alternative the design text prescribes, hasContent(). While
      // decorative every imageAlt is '', so a row holding nothing but alt text
      // is empty by hasContent()'s reckoning and would be skipped -- silently
      // destroying the one value the restore exists to bring back.
      const model = seriesWithAltOnlyLanguage('de', 'Nur Alt-Text');
      const wrapper = mountEditor(model, 'en');

      await decorativeRadio(wrapper).trigger('change');
      expect(model.content('de').imageAlt).toBe('');
      expect(model.hasContent('de')).toBe(false);

      await describeRadio(wrapper).trigger('change');

      expect(model.content('de').imageAlt).toBe('Nur Alt-Text');
      expect(model.content('en').imageAlt).toBe('A poster');
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

  /*
   * This component authors the data that drives screen-reader behaviour
   * elsewhere, so its own associations are pinned rather than assumed. Each
   * assertion below is the fix for a finding from the screen-reader walk: help
   * text that was announced twice, and a hint that was never announced at all.
   */
  describe('screen-reader associations', () => {

    it('associates the length hint with the textarea instead of leaving it a sibling', () => {
      const wrapper = mountEditor(seriesWithAlts({ en: 'A poster' }), 'en');

      const describedBy = wrapper.find('textarea').attributes('aria-describedby');
      expect(describedBy).toBeTruthy();

      const hint = wrapper.find(`#${describedBy}`);
      expect(hint.exists()).toBe(true);
      expect(hint.text()).toContain('Write what the image shows');
    });

    it('describes each radio by its help text rather than naming it with it', () => {
      const wrapper = mountEditor(seriesWithAlts({ en: 'A poster' }), 'en');

      for (const radio of [decorativeRadio(wrapper), describeRadio(wrapper)]) {
        const radioId = radio.attributes('id');
        const describedBy = radio.attributes('aria-describedby');
        expect(describedBy).toBeTruthy();

        const help = wrapper.find(`#${describedBy}`);
        expect(help.exists()).toBe(true);

        // The label carries the option name only -- the help text must sit
        // outside it, or it joins the radio's accessible name.
        const label = wrapper.find(`label[for="${radioId}"]`);
        expect(label.exists()).toBe(true);
        expect(label.text()).not.toContain(help.text());
        expect(label.element.contains(help.element)).toBe(false);
      }
    });

    it('labels the radios with the visible option text so the label stays clickable', () => {
      const wrapper = mountEditor(seriesWithAlts({ en: 'A poster' }), 'en');

      const decorativeLabel = wrapper.find(`label[for="${decorativeRadio(wrapper).attributes('id')}"]`);
      const describeLabel = wrapper.find(`label[for="${describeRadio(wrapper).attributes('id')}"]`);

      expect(decorativeLabel.text()).toBe('Decorative');
      expect(describeLabel.text()).toBe('Describe this image');
    });

    it('announces the pending loss as an alert, not a passive status', async () => {
      const wrapper = mountEditor(seriesWithAlts({ en: 'A poster' }), 'en');

      await decorativeRadio(wrapper).trigger('change');

      expect(wrapper.find('.alert--warning').attributes('role')).toBe('alert');
    });
  });
});
