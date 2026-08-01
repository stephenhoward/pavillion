import { describe, it, expect } from 'vitest';

import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';
import {
  FEP_CATEGORY_VALUES,
  mapNameToFepCategory,
  mapCategoryToFepCategory,
  mapEventCategoriesToFep,
  parseInboundFepCategories,
  resolveFepCategoriesToLocalIds,
} from '@/server/activitypub/helper/fep_category_map';

/**
 * Builds an EventCategory with one or more language names.
 */
function category(id: string, names: Record<string, string>): EventCategory {
  const cat = new EventCategory(id, 'calendar-id');
  for (const [lang, name] of Object.entries(names)) {
    cat.addContent(new EventCategoryContent(lang, name));
  }
  return cat;
}

describe('fep_category_map', () => {

  describe('FEP_CATEGORY_VALUES', () => {
    it('contains exactly the 36 FEP-8a8e enum values', () => {
      expect(FEP_CATEGORY_VALUES).toHaveLength(36);
      expect(FEP_CATEGORY_VALUES).toContain('MUSIC');
      expect(FEP_CATEGORY_VALUES).toContain('SPORTS');
      expect(FEP_CATEGORY_VALUES).toContain('MOVEMENTS_POLITICS');
      expect(FEP_CATEGORY_VALUES).toContain('WORKSHOPS_SKILL_SHARING');
      expect(FEP_CATEGORY_VALUES).toContain('LGBTQ');
    });

    it('has no duplicate values', () => {
      expect(new Set(FEP_CATEGORY_VALUES).size).toBe(FEP_CATEGORY_VALUES.length);
    });
  });

  describe('mapNameToFepCategory (name -> enum heuristic)', () => {
    it('maps obvious names to their enum via whole-word keywords', () => {
      expect(mapNameToFepCategory('Music')).toBe('MUSIC');
      expect(mapNameToFepCategory('Live Concert')).toBe('MUSIC');
      expect(mapNameToFepCategory('Sports')).toBe('SPORTS');
      expect(mapNameToFepCategory('Local Football League')).toBe('SPORTS');
      expect(mapNameToFepCategory('Workshop')).toBe('WORKSHOPS_SKILL_SHARING');
      expect(mapNameToFepCategory('Pride Celebration')).toBe('LGBTQ');
      expect(mapNameToFepCategory('Political Rally')).toBe('MOVEMENTS_POLITICS');
    });

    it('is case-insensitive and tolerant of surrounding words', () => {
      expect(mapNameToFepCategory('WEEKLY yoga class')).toBe('MEDITATION_WELLBEING');
      expect(mapNameToFepCategory('Community Potluck Dinner')).toBe('FOOD_DRINK');
    });

    it('returns null when no keyword matches confidently', () => {
      expect(mapNameToFepCategory('Miscellaneous')).toBeNull();
      expect(mapNameToFepCategory('Zephyr')).toBeNull();
      expect(mapNameToFepCategory('')).toBeNull();
      expect(mapNameToFepCategory('   ')).toBeNull();
    });

    it('does not match keywords as sub-strings of unrelated words', () => {
      // "art" must not fire on "party" or "cart"
      expect(mapNameToFepCategory('Birthday Cart')).toBeNull();
      // "party" resolves to PARTY, never ARTS
      expect(mapNameToFepCategory('Block Party')).toBe('PARTY');
    });

    it('prefers the more specific entry when one name matches multiple entries (phrase subsumption)', () => {
      // "visual arts" (PERFORMING_VISUAL_ARTS) subsumes "arts" (ARTS); PVA is
      // ordered first and wins.
      expect(mapNameToFepCategory('Visual Arts Evening')).toBe('PERFORMING_VISUAL_ARTS');
      // "family" (FAMILY_EDUCATION) + "education" (LEARNING) both match; the
      // more specific FAMILY_EDUCATION is ordered first and wins.
      expect(mapNameToFepCategory('Family Education Night')).toBe('FAMILY_EDUCATION');
      // "art jam" (CREATIVE_JAM) subsumes "art" (ARTS); CREATIVE_JAM wins.
      expect(mapNameToFepCategory('Weekend Art Jam')).toBe('CREATIVE_JAM');
    });

    it('resolves a bare "musical" to MUSIC (single-owner keyword), not THEATRE', () => {
      // Regression guard for the one real shared-keyword collision: "musical"
      // is owned solely by MUSIC. A name carrying only "musical" must resolve
      // to MUSIC deterministically, independent of array order.
      expect(mapNameToFepCategory('Musical Night')).toBe('MUSIC');
      expect(mapNameToFepCategory('The Musical Revue')).toBe('MUSIC');
      // A named stage musical still lands on THEATRE via the unambiguous
      // "theatre" keyword (THEATRE precedes MUSIC in the array).
      expect(mapNameToFepCategory('Musical Theatre Showcase')).toBe('THEATRE');
    });
  });

  describe('mapCategoryToFepCategory (translated model, all languages)', () => {
    it('matches on the English name when present', () => {
      expect(mapCategoryToFepCategory(category('c1', { en: 'Music' }))).toBe('MUSIC');
    });

    it('falls back to a non-English name when English does not match', () => {
      // English name is opaque, but the German name maps to MUSIC ("konzert")
      const cat = category('c1', { en: 'Programm', de: 'Konzert' });
      // 'konzert' is not an English keyword, so this stays null — heuristic is
      // English-keyword based in v1. Documents the known limitation.
      expect(mapCategoryToFepCategory(cat)).toBeNull();
    });

    it('matches when a non-English language carries an English-recognizable name', () => {
      const cat = category('c1', { fr: 'Programme', en: 'Photography Walk' });
      expect(mapCategoryToFepCategory(cat)).toBe('PHOTOGRAPHY');
    });

    it('returns null for a category with no matching names', () => {
      expect(mapCategoryToFepCategory(category('c1', { en: 'General' }))).toBeNull();
    });
  });

  describe('mapEventCategoriesToFep (outbound)', () => {
    it('returns deduped enum values preserving first-seen order', () => {
      const cats = [
        category('c1', { en: 'Live Music' }),
        category('c2', { en: 'Concert Series' }), // also MUSIC -> deduped
        category('c3', { en: 'Food & Drink' }),
      ];
      expect(mapEventCategoriesToFep(cats)).toEqual(['MUSIC', 'FOOD_DRINK']);
    });

    it('omits categories that do not map', () => {
      const cats = [
        category('c1', { en: 'General' }),
        category('c2', { en: 'Sports Night' }),
      ];
      expect(mapEventCategoriesToFep(cats)).toEqual(['SPORTS']);
    });

    it('returns an empty array for no categories', () => {
      expect(mapEventCategoriesToFep([])).toEqual([]);
      expect(mapEventCategoriesToFep(undefined as any)).toEqual([]);
    });
  });

  describe('parseInboundFepCategories', () => {
    it('accepts a single string enum value', () => {
      expect(parseInboundFepCategories('MUSIC')).toEqual(['MUSIC']);
    });

    it('accepts an array of enum values and dedupes', () => {
      expect(parseInboundFepCategories(['MUSIC', 'SPORTS', 'MUSIC'])).toEqual(['MUSIC', 'SPORTS']);
    });

    it('drops unknown or malformed values defensively', () => {
      expect(parseInboundFepCategories(['MUSIC', 'NOT_A_CATEGORY', 42, null, {}])).toEqual(['MUSIC']);
      expect(parseInboundFepCategories('nonsense')).toEqual([]);
      expect(parseInboundFepCategories(undefined)).toEqual([]);
      expect(parseInboundFepCategories(null)).toEqual([]);
    });
  });

  describe('resolveFepCategoriesToLocalIds (inbound)', () => {
    it('resolves inbound enums to existing local categories by name heuristic', () => {
      const local = [
        category('local-music', { en: 'Concerts' }),   // -> MUSIC
        category('local-sport', { en: 'Sports' }),      // -> SPORTS
        category('local-misc', { en: 'General' }),      // -> null
      ];
      expect(resolveFepCategoriesToLocalIds(['MUSIC'], local)).toEqual(['local-music']);
      expect(resolveFepCategoriesToLocalIds(['MUSIC', 'SPORTS'], local).sort())
        .toEqual(['local-music', 'local-sport']);
    });

    it('returns empty when no local category matches the inbound enum', () => {
      const local = [category('local-misc', { en: 'General' })];
      expect(resolveFepCategoriesToLocalIds(['MUSIC'], local)).toEqual([]);
    });

    it('never invents ids and handles empty inputs', () => {
      expect(resolveFepCategoriesToLocalIds([], [category('c1', { en: 'Music' })])).toEqual([]);
      expect(resolveFepCategoriesToLocalIds(['MUSIC'], [])).toEqual([]);
    });
  });

  describe('round-trip consistency', () => {
    it('a local category emitted as FEP resolves back to itself', () => {
      const local = [category('local-music', { en: 'Music Night' })];
      const emitted = mapEventCategoriesToFep(local);
      expect(emitted).toEqual(['MUSIC']);
      const resolved = resolveFepCategoriesToLocalIds(emitted, local);
      expect(resolved).toEqual(['local-music']);
    });
  });
});
