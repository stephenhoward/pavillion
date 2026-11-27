import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DISK_ALERT_GUIDE_URL } from '@/server/housekeeping/model/disk-alert-guide-url';
import { DiskAlertLocale, LIKELIHOOD_WORDS, findLikelihoodWord } from '@/server/housekeeping/test/disk-alert-wording';

const ROOT = path.resolve();
const LOCALES: DiskAlertLocale[] = ['en', 'es', 'fr'];

const EXPECTED_KEYS: Record<string, string[]> = {
  disk_warning_email: [
    'subject', 'title', 'greeting', 'current_usage', 'threshold', 'footer_note', 'footer_text',
    'signature', 'disk_scope', 'first_step', 'guide_link_text', 'action_expand_storage',
  ],
  disk_critical_email: [
    'subject', 'title', 'greeting', 'current_usage', 'threshold', 'footer_text',
    'signature', 'disk_scope', 'first_step', 'guide_link_text', 'action_expand_storage',
  ],
};

/** What disk_scope lists as possibly filling the disk, in each locale's wording. */
const DISK_SCOPE_ITEMS: Record<DiskAlertLocale, string[]> = {
  en: ['backups', 'container images', 'the database', 'uploaded media'],
  es: ['archivos multimedia subidos', 'base de datos', 'copias de seguridad', 'imágenes de contenedor'],
  fr: ['base de données', 'images de conteneur', 'médias téléversés', 'sauvegardes'],
};

const TEMPLATES = [
  'disk-warning.html.hbs',
  'disk-warning.text.hbs',
  'disk-critical.html.hbs',
  'disk-critical.text.hbs',
];

function readLocale(locale: DiskAlertLocale, namespace: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'src/server/locales', locale, `${namespace}.json`), 'utf8'));
}

/**
 * The disk alert copy, checked at the source: both email files carry the same
 * key set in every locale, no template opens a triple-brace (unescaped)
 * output, no locale string ranks a cause, and the guide link the emails carry
 * is the one bin/deploy.sh points at.
 */
describe('disk alert copy', () => {
  describe.each(Object.keys(EXPECTED_KEYS))('%s', (namespace) => {
    it.each(LOCALES)('has exactly the designed key set in %s', (locale) => {
      expect(Object.keys(readLocale(locale, namespace)).sort()).toEqual([...EXPECTED_KEYS[namespace]].sort());
    });

    it.each(LOCALES)('contains no likelihood word in any %s string', (locale) => {
      for (const [key, value] of Object.entries(readLocale(locale, namespace))) {
        expect({ key, word: findLikelihoodWord(value, LIKELIHOOD_WORDS[locale]) }).toEqual({ key, word: null });
      }
    });

    it.each(LOCALES)('lists the disk_scope possibilities in %s alphabetical order', (locale) => {
      const scope = readLocale(locale, namespace).disk_scope;
      // lastIndexOf: the list closes the string, and "copias de seguridad" /
      // "sauvegardes" also name the backup directory earlier in it.
      const positions = DISK_SCOPE_ITEMS[locale].map(item => ({ item, at: scope.lastIndexOf(item) }));
      expect(positions.filter(({ at }) => at < 0)).toEqual([]);

      const asListed = [...positions].sort((a, b) => a.at - b.at).map(({ item }) => item);
      const collated = [...DISK_SCOPE_ITEMS[locale]].sort(new Intl.Collator(locale).compare);
      expect(asListed).toEqual(collated);
    });
  });

  it.each(TEMPLATES)('%s uses double-brace output only', (template) => {
    const source = fs.readFileSync(path.join(ROOT, 'src/server/housekeeping/templates', template), 'utf8');

    expect(source).not.toContain('{{{');
  });

  it('links the same guide section bin/deploy.sh points at', () => {
    const deployScript = fs.readFileSync(path.join(ROOT, 'bin/deploy.sh'), 'utf8');
    const declared = deployScript.match(/^DISK_ALERT_GUIDE_URL="([^"]+)"$/m);

    expect(declared?.[1]).toBe(DISK_ALERT_GUIDE_URL);
  });

  it('the matcher matches whole tokens and phrases only', () => {
    expect(findLikelihoodWord('Soften the tone', LIKELIHOOD_WORDS.en)).toBeNull();
    expect(findLikelihoodWord('It is <b>often</b> the images', LIKELIHOOD_WORDS.en)).toBe('often');
    expect(findLikelihoodWord('C&#x27;est le plus souvent ça', ['le plus souvent'])).toBe('le plus souvent');
    expect(findLikelihoodWord('Pasa a menudo', LIKELIHOOD_WORDS.es)).toBe('a menudo');
    expect(findLikelihoodWord('Una vez rara', ['rara vez'])).toBeNull();
  });
});
