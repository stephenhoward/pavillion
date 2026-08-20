import { describe, it, expect } from 'vitest';

import enInbox from '@/client/locales/en/inbox.json';
import esInbox from '@/client/locales/es/inbox.json';
import frInbox from '@/client/locales/fr/inbox.json';

/**
 * Locale guard for the inbox row's slot grammar.
 *
 * The inbox renders each row's sentence through the `<i18next>` component,
 * which splices the object's link into the `{1}` slot. A locale whose
 * sentence has lost the slot renders the row with no link at all — the
 * row silently stops being navigable in that language, with nothing in the
 * component or the store to notice.
 *
 * French is the reason the slot is mandatory rather than a convention: in
 * both report sentences `{1}` sits mid-sentence ("Un signalement concernant
 * {1} a été transmis"), so any implementation that appends the object label
 * to a suffix produces broken French. This test fails the moment a
 * translation drops or blanks the slot.
 */

const LOCALES: Record<string, { notifications: Record<string, string> }> = {
  en: enInbox,
  es: esInbox,
  fr: frInbox,
};

/** Keys whose sentence must carry the `{1}` slot the object link renders into. */
const LINKED_SENTENCE_KEYS = [
  'repost_sentence',
  'flag_sentence',
  'editor_invited_sentence',
  'report_escalated_sentence',
  'report_resolved_sentence',
];

/** Keys whose accessible name is built from the row's rendered content. */
const CONTENT_INTERPOLATED_KEYS = [
  'mark_seen_aria_label',
  'dismiss_aria_label',
];

/**
 * Keys rendered as standalone phrases with no interpolation.
 *
 * `unread_badge` is composed into the mark-as-read button's accessible name;
 * `mark_seen_status` and `dismiss_status` are the only two strings the inbox's
 * live region ever holds. A locale that drops or blanks any of them loses the
 * state information silently — the row still renders, and dismissing still
 * removes it, just without the change a screen-reader user needs announced.
 */
const STANDALONE_PHRASE_KEYS = [
  'unread_badge',
  'mark_seen_status',
  'dismiss_status',
];

describe('inbox locale slot grammar', () => {
  for (const [language, resource] of Object.entries(LOCALES)) {
    describe(language, () => {
      for (const key of LINKED_SENTENCE_KEYS) {
        it(`defines a non-empty ${key} containing the {1} object slot`, () => {
          const value = resource.notifications[key];
          expect(typeof value).toBe('string');
          expect(value.trim()).not.toBe('');
          expect(value).toContain('{1}');
        });
      }

      for (const key of CONTENT_INTERPOLATED_KEYS) {
        it(`defines a non-empty ${key} interpolating {{content}}`, () => {
          const value = resource.notifications[key];
          expect(typeof value).toBe('string');
          expect(value.trim()).not.toBe('');
          expect(value).toContain('{{content}}');
        });
      }

      for (const key of STANDALONE_PHRASE_KEYS) {
        it(`defines a non-empty ${key}`, () => {
          const value = resource.notifications[key];
          expect(typeof value).toBe('string');
          expect(value.trim()).not.toBe('');
        });
      }

      it('no longer defines the pre-slot suffix keys they replaced', () => {
        expect(resource.notifications).not.toHaveProperty('repost_suffix');
        expect(resource.notifications).not.toHaveProperty('flag_suffix');
        expect(resource.notifications).not.toHaveProperty('editor_invited_suffix');
      });
    });
  }
});
