import type { EventCategory } from '@/common/model/event_category';

/**
 * FEP-8a8e event category vocabulary and Pavillion mapping helpers.
 *
 * FEP-8a8e (https://w3id.org/fep/8a8e) defines a shared, controlled vocabulary
 * for the bare `category` property on an Event. Pavillion's own categories are
 * instance-defined, translatable `EventCategory` models (no static enum), so
 * there is no authoritative mapping onto the FEP vocabulary. This module
 * implements a keyword heuristic (v1) that matches category NAMES — in every
 * language the category carries — against the FEP enum values.
 *
 * Directionality:
 *  - Outbound: {@link mapEventCategoriesToFep} turns a Pavillion event's
 *    categories into the deduped list of confidently-matched FEP enum values,
 *    emitted as the bare FEP `category` property ALONGSIDE the existing
 *    `pavillion:categories` URIs (which still carry full Pavillion↔Pavillion
 *    fidelity). Unmatched categories emit nothing.
 *  - Inbound: {@link resolveFepCategoriesToLocalIds} maps inbound FEP enum
 *    values back onto a calendar's EXISTING local categories by running each
 *    local category name through the same heuristic. It never invents
 *    categories — federation input is not allowed to create instance taxonomy.
 *
 * Admin-overridable mappings are intentionally OUT OF SCOPE for v1; if the
 * heuristic proves too weak, an override layer is the documented follow-up.
 */

/**
 * The FEP-8a8e `category` controlled vocabulary — the exact 36 enum values
 * from the FEP-8a8e recommended-categories list. Emitted verbatim on the wire.
 */
export const FEP_CATEGORY_VALUES = [
  'ARTS',
  'AUTO_BOAT_AIR',
  'BOOK_CLUBS',
  'BUSINESS',
  'CAUSES',
  'CLIMATE_ENVIRONMENT',
  'COMMUNITY',
  'COMEDY',
  'CRAFTS',
  'CREATIVE_JAM',
  'DIY_MAKER_SPACES',
  'FAMILY_EDUCATION',
  'FASHION_BEAUTY',
  'FESTIVALS',
  'FILM_MEDIA',
  'FOOD_DRINK',
  'GAMES',
  'INCLUSIVE_SPACES',
  'LANGUAGE_CULTURE',
  'LEARNING',
  'LGBTQ',
  'MEETING',
  'MEDITATION_WELLBEING',
  'MOVEMENTS_POLITICS',
  'MUSIC',
  'NETWORKING',
  'OUTDOORS_ADVENTURE',
  'PARTY',
  'PERFORMING_VISUAL_ARTS',
  'PETS',
  'PHOTOGRAPHY',
  'SCIENCE_TECH',
  'SPIRITUALITY_RELIGION_BELIEFS',
  'SPORTS',
  'THEATRE',
  'WORKSHOPS_SKILL_SHARING',
] as const;

export type FepCategory = typeof FEP_CATEGORY_VALUES[number];

const FEP_CATEGORY_SET: ReadonlySet<string> = new Set(FEP_CATEGORY_VALUES);

/**
 * Ordered keyword heuristic. Each entry maps a FEP enum value to a list of
 * lowercase keywords; a category name matches an entry when any keyword occurs
 * as a whole word in the name. The list is evaluated top-to-bottom and the
 * FIRST matching entry wins.
 *
 * Ordering only changes the result when a SINGLE name matches keywords in more
 * than one entry. Two mechanisms create that situation, and both are resolved
 * by putting the more-specific entry FIRST:
 *   - Phrase subsumption — a specific multi-word keyword contains a generic
 *     one. "Visual Arts" matches PERFORMING_VISUAL_ARTS (`visual arts`) AND
 *     ARTS (`arts`); PVA is ordered first and wins. Likewise "Family Education"
 *     matches FAMILY_EDUCATION (`family`) AND LEARNING (`education`), and
 *     "Art Jam" matches CREATIVE_JAM (`art jam`) AND ARTS (`art`).
 *   - Shared bare keyword — the SAME keyword string appears under two entries.
 *     This is deliberately avoided: every bare keyword is owned by exactly one
 *     entry, so the result never depends on order for a shared keyword. In
 *     particular `musical` is owned solely by MUSIC (a bare "Musical" reads as
 *     music); a stage musical named "Musical Theatre" still resolves to THEATRE
 *     via the unambiguous `theatre` keyword, since THEATRE precedes MUSIC.
 *
 * Entries whose keyword sets do not overlap any other entry (e.g. THEATRE vs
 * ARTS, MEDITATION_WELLBEING vs SPIRITUALITY_RELIGION_BELIEFS) are order-
 * independent; their relative position is retained only as defensive guidance
 * for future keyword additions.
 */
const CATEGORY_KEYWORDS: ReadonlyArray<readonly [FepCategory, readonly string[]]> = [
  ['LGBTQ', ['lgbtq', 'lgbtqia', 'lgbt', 'queer', 'pride', 'gay', 'lesbian', 'trans', 'transgender', 'nonbinary', 'non-binary']],
  ['MOVEMENTS_POLITICS', ['politics', 'political', 'protest', 'rally', 'activism', 'activist', 'campaign', 'election', 'demonstration', 'movement', 'union']],
  ['CLIMATE_ENVIRONMENT', ['climate', 'environment', 'environmental', 'sustainability', 'sustainable', 'ecology', 'ecological', 'conservation', 'recycling']],
  ['CAUSES', ['cause', 'causes', 'charity', 'charitable', 'fundraiser', 'fundraising', 'donation', 'nonprofit', 'benefit', 'philanthropy']],
  ['COMEDY', ['comedy', 'comedic', 'standup', 'stand-up']],
  ['THEATRE', ['theatre', 'theater', 'drama', 'improv']],
  ['PERFORMING_VISUAL_ARTS', ['performing arts', 'visual arts', 'dance', 'dancing', 'ballet', 'opera', 'performance']],
  ['PHOTOGRAPHY', ['photography', 'photo', 'photos', 'photographer']],
  ['FILM_MEDIA', ['film', 'films', 'movie', 'movies', 'cinema', 'screening', 'documentary', 'media']],
  ['MUSIC', ['music', 'musical', 'concert', 'concerts', 'gig', 'band', 'bands', 'orchestra', 'choir', 'symphony', 'recital', 'dj']],
  ['CREATIVE_JAM', ['creative jam', 'art jam', 'jam session']],
  ['ARTS', ['art', 'arts', 'gallery', 'exhibition', 'exhibit', 'painting', 'sculpture']],
  ['BOOK_CLUBS', ['book club', 'book clubs', 'books', 'reading', 'literature', 'author', 'poetry']],
  ['GAMES', ['game', 'games', 'gaming', 'boardgame', 'board game', 'tabletop', 'chess', 'trivia', 'esports', 'video game']],
  ['SPORTS', ['sport', 'sports', 'football', 'soccer', 'basketball', 'baseball', 'hockey', 'tennis', 'marathon', 'cycling', 'rugby', 'cricket', 'volleyball', 'athletics']],
  ['OUTDOORS_ADVENTURE', ['outdoor', 'outdoors', 'hiking', 'hike', 'camping', 'adventure', 'trail', 'kayaking', 'climbing']],
  ['MEDITATION_WELLBEING', ['meditation', 'wellbeing', 'well-being', 'wellness', 'mindfulness', 'yoga', 'self-care']],
  ['SPIRITUALITY_RELIGION_BELIEFS', ['spiritual', 'spirituality', 'religion', 'religious', 'church', 'worship', 'faith', 'prayer', 'temple', 'mosque', 'synagogue']],
  ['FOOD_DRINK', ['food', 'drink', 'drinks', 'dinner', 'lunch', 'brunch', 'tasting', 'culinary', 'cooking', 'wine', 'beer', 'coffee', 'restaurant', 'potluck', 'barbecue', 'bbq']],
  ['CRAFTS', ['craft', 'crafts', 'knitting', 'sewing', 'quilting', 'pottery', 'ceramics', 'crochet']],
  ['DIY_MAKER_SPACES', ['diy', 'maker', 'makerspace', 'fabrication', 'woodworking']],
  ['WORKSHOPS_SKILL_SHARING', ['workshop', 'workshops', 'skillshare', 'skill-share', 'skill share', 'seminar', 'tutorial', 'training']],
  ['SCIENCE_TECH', ['science', 'scientific', 'tech', 'technology', 'coding', 'programming', 'hackathon', 'robotics', 'engineering', 'software', 'developer']],
  ['FASHION_BEAUTY', ['fashion', 'beauty', 'makeup', 'cosmetics']],
  ['PETS', ['pet', 'pets', 'dog', 'dogs', 'cat', 'cats', 'animal', 'animals']],
  ['FAMILY_EDUCATION', ['family', 'kids', 'children', 'parenting', 'school']],
  ['LEARNING', ['learning', 'lecture', 'class', 'course', 'study', 'education', 'educational']],
  ['LANGUAGE_CULTURE', ['language', 'culture', 'cultural', 'heritage', 'linguistic']],
  ['FESTIVALS', ['festival', 'festivals', 'fest', 'carnival', 'fair']],
  ['PARTY', ['party', 'parties', 'celebration', 'nightlife']],
  ['NETWORKING', ['networking', 'meetup', 'mixer']],
  ['BUSINESS', ['business', 'entrepreneur', 'entrepreneurship', 'startup', 'marketing', 'finance']],
  ['MEETING', ['meeting', 'assembly']],
  ['COMMUNITY', ['community', 'neighborhood', 'neighbourhood', 'volunteer', 'civic']],
  ['INCLUSIVE_SPACES', ['inclusive', 'accessibility', 'disability', 'neurodiverse', 'safe space']],
  ['AUTO_BOAT_AIR', ['automotive', 'motorcycle', 'boat', 'sailing', 'aviation', 'aircraft']],
];

/**
 * Precompiled keyword matchers. Each keyword becomes a whole-word regex so that
 * e.g. `art` matches "Art" and "Art Show" but NOT "party" or "cart".
 */
const COMPILED_KEYWORDS: ReadonlyArray<readonly [FepCategory, RegExp]> = CATEGORY_KEYWORDS.map(
  ([fep, keywords]) => [
    fep,
    new RegExp(
      '(?:^|[^a-z0-9])(?:' + keywords.map(escapeRegExp).join('|') + ')(?:[^a-z0-9]|$)',
      'i',
    ),
  ] as const,
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Maps a single category name onto a FEP-8a8e enum value using the keyword
 * heuristic. Returns the first (highest-priority) matching enum value, or null
 * when no keyword matches confidently.
 */
export function mapNameToFepCategory(name: string): FepCategory | null {
  if (typeof name !== 'string') {
    return null;
  }
  const normalized = name.toLowerCase().trim();
  if (normalized.length === 0) {
    return null;
  }
  for (const [fep, matcher] of COMPILED_KEYWORDS) {
    if (matcher.test(normalized)) {
      return fep;
    }
  }
  return null;
}

/**
 * Maps a Pavillion EventCategory onto a FEP-8a8e enum value by running every
 * language name it carries through the heuristic. English is checked first for
 * determinism, then remaining languages in their existing order. Returns the
 * first confident match across all names, or null.
 */
export function mapCategoryToFepCategory(category: EventCategory): FepCategory | null {
  if (!category) {
    return null;
  }
  const languages = category.getLanguages();
  const ordered = languages.includes('en')
    ? ['en', ...languages.filter(lang => lang !== 'en')]
    : languages;

  for (const lang of ordered) {
    const content = category._content[lang];
    const match = content ? mapNameToFepCategory(content.name) : null;
    if (match) {
      return match;
    }
  }
  return null;
}

/**
 * Outbound: maps a Pavillion event's categories onto the deduped, order-preserved
 * list of FEP-8a8e enum values for the bare `category` property. Categories that
 * do not map to any enum value contribute nothing. Returns an empty array when
 * no category maps — callers omit the `category` property entirely in that case.
 */
export function mapEventCategoriesToFep(categories: EventCategory[]): FepCategory[] {
  if (!Array.isArray(categories) || categories.length === 0) {
    return [];
  }
  const seen = new Set<FepCategory>();
  const result: FepCategory[] = [];
  for (const category of categories) {
    const fep = mapCategoryToFepCategory(category);
    if (fep && !seen.has(fep)) {
      seen.add(fep);
      result.push(fep);
    }
  }
  return result;
}

/**
 * Normalizes an inbound FEP `category` field (string or @list array of strings)
 * into the deduped set of recognized FEP enum values. Unknown or malformed
 * entries are dropped defensively.
 */
export function parseInboundFepCategories(raw: unknown): FepCategory[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const seen = new Set<FepCategory>();
  const result: FepCategory[] = [];
  for (const value of values) {
    if (typeof value === 'string' && FEP_CATEGORY_SET.has(value)) {
      const fep = value as FepCategory;
      if (!seen.has(fep)) {
        seen.add(fep);
        result.push(fep);
      }
    }
  }
  return result;
}

/**
 * Inbound: resolves a set of inbound FEP enum values onto a calendar's EXISTING
 * local categories, by running each local category name through the same
 * heuristic and keeping those whose mapped enum is in the inbound set. Returns
 * the deduped list of matching local category ids. Never creates categories —
 * only local categories that already exist can match.
 */
export function resolveFepCategoriesToLocalIds(
  fepValues: FepCategory[],
  localCategories: EventCategory[],
): string[] {
  if (fepValues.length === 0 || !Array.isArray(localCategories) || localCategories.length === 0) {
    return [];
  }
  const wanted = new Set<FepCategory>(fepValues);
  const seenIds = new Set<string>();
  const result: string[] = [];
  for (const category of localCategories) {
    const fep = mapCategoryToFepCategory(category);
    if (fep && wanted.has(fep) && !seenIds.has(category.id)) {
      seenIds.add(category.id);
      result.push(category.id);
    }
  }
  return result;
}
