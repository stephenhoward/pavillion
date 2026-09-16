import { describe, it, expect, afterEach } from 'vitest';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import { EventSeries } from '@/common/model/event_series';
import { EventCategory } from '@/common/model/event_category';
import { EventLocation, EventLocationSpace } from '@/common/model/location';
import { TranslatedContentModel, TranslatedModel } from '@/common/model/model';

/**
 * Coverage for the {@link TranslatedModel.displayName} helper added in
 * pv-q259. Asserted behaviour:
 *   - first language with populated name wins (deterministic snapshot)
 *   - empty model returns the fallback (no language, no content)
 *   - populated model with no name returns the fallback
 *   - whitespace-only name is treated as empty and falls back
 *   - default fallback is the empty string
 *
 * Calendar and CalendarEvent are the two production call sites; both
 * exercise the same base-class method so coverage on one representative
 * subclass plus one cross-check is sufficient.
 */
describe('TranslatedModel.displayName', () => {
  it('returns the first available language\'s name when one language is populated', () => {
    const calendar = new Calendar('cal-1');
    calendar.addContent(new CalendarContent('en', 'Community Hub'));
    expect(calendar.displayName()).toBe('Community Hub');
  });

  it('returns the first language\'s name when multiple languages are populated', () => {
    const calendar = new Calendar('cal-1');
    // Insertion order is the language-selection order — first added wins.
    calendar.addContent(new CalendarContent('en', 'Community Hub'));
    calendar.addContent(new CalendarContent('fr', 'Centre Communautaire'));
    expect(calendar.displayName()).toBe('Community Hub');
  });

  it('returns the supplied fallback when no languages are present', () => {
    const calendar = new Calendar('cal-1');
    expect(calendar.displayName('Unknown Calendar')).toBe('Unknown Calendar');
  });

  it('returns the supplied fallback when the populated language has an empty name', () => {
    const calendar = new Calendar('cal-1');
    calendar.addContent(new CalendarContent('en', ''));
    expect(calendar.displayName('Unknown Calendar')).toBe('Unknown Calendar');
  });

  it('falls back when the resolved name is whitespace-only', () => {
    // A blank-but-non-empty label would otherwise reach the inbox snapshot
    // and render as whitespace with no recovery path — the helper trims
    // before applying the `||` short-circuit so whitespace-only names
    // are treated as empty.
    const calendar = new Calendar('cal-1');
    calendar.addContent(new CalendarContent('en', '   '));
    expect(calendar.displayName('Unknown Calendar')).toBe('Unknown Calendar');
  });

  it('returns the empty string by default when no name is resolved', () => {
    const calendar = new Calendar('cal-1');
    expect(calendar.displayName()).toBe('');
  });

  it('works the same way on CalendarEvent (cross-subclass smoke test)', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    event.addContent(new CalendarEventContent('en', 'Annual Conference 2026'));
    expect(event.displayName('Event')).toBe('Annual Conference 2026');
  });

  it('falls back on CalendarEvent when the title is missing', () => {
    const event = new CalendarEvent('evt-1', 'cal-1');
    expect(event.displayName('Event')).toBe('Event');
  });
});

/**
 * Language codes reach `_content` from request bodies, so every key the map
 * accepts has to be ordinary data. Two properties are asserted here:
 *
 *   1. No lookup ever resolves through a prototype chain. A plain-object map
 *      answers `_content['__proto__']` with `Object.prototype`, which the old
 *      truthiness guard read as "a row is already present" — `content()` then
 *      handed `Object.prototype` to its caller, and the caller's assignments
 *      landed on every object in the process.
 *   2. The lazy-create contract is unchanged for ordinary language codes: the
 *      first call builds and stores a row, later calls return that same row.
 *
 * `constructor`, `toString` and `valueOf` are covered alongside `__proto__`
 * because they also resolve to something truthy off `Object.prototype`;
 * `prototype` is covered because it reads as absent on a plain object and so
 * would hide a regression that only the other keys expose.
 *
 * The keys are exercised through Calendar; `_content` and every accessor live
 * on TranslatedModel, so one representative subclass covers all of them.
 */
describe('TranslatedModel content map hardening', () => {
  const HOSTILE_KEYS = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf'];
  const WRITTEN_FIELDS = ['name', 'description', 'imageAlt'];

  const emptyObject = () => ({}) as Record<string, unknown>;

  afterEach(() => {
    // A failing assertion below means the write has already landed on the
    // shared prototype. Clear it so the remainder of the suite — and every
    // other file in the worker — is not run against a polluted
    // Object.prototype.
    for (const field of WRITTEN_FIELDS) {
      delete (Object.prototype as Record<string, unknown>)[field];
    }
  });

  it('gives the content map a null prototype', () => {
    expect(Object.getPrototypeOf(new Calendar('cal-1')._content)).toBeNull();
  });

  it.each(HOSTILE_KEYS)('content(%s) returns a fresh content row, not an inherited object', (key) => {
    const calendar = new Calendar('cal-1');
    const content = calendar.content(key);

    expect(content).toBeInstanceOf(CalendarContent);
    expect(content).not.toBe(Object.prototype);
    expect(content.language).toBe(key);

    content.name = 'PWNED';
    content.description = 'PWNED';
    content.imageAlt = 'ALT-PWNED';

    expect(emptyObject().name).toBeUndefined();
    expect(emptyObject().description).toBeUndefined();
    expect(emptyObject().imageAlt).toBeUndefined();

    // The row was stored on the model as an own key rather than re-parenting
    // the map or vanishing.
    expect(calendar.getLanguages()).toContain(key);
    expect(calendar.content(key)).toBe(content);
    expect(Object.getPrototypeOf(calendar._content)).toBeNull();
  });

  it('cannot be polluted by a loop over a JSON-parsed content map', () => {
    // Reproduces the shape an API handler works with: `express.json()` parses
    // with JSON.parse, which — unlike an object literal — makes `__proto__` an
    // own enumerable property, so it survives Object.entries and reaches
    // content() as a language code.
    const body = JSON.parse('{"__proto__":{"name":"PWNED","description":"PWNED","imageAlt":"ALT-PWNED"}}');
    expect(Object.keys(body)).toEqual(['__proto__']);

    const calendar = new Calendar('cal-1');
    for (const [language, values] of Object.entries(body) as [string, Record<string, string>][]) {
      const content = calendar.content(language);
      content.name = values.name;
      content.description = values.description;
      content.imageAlt = values.imageAlt;
    }

    expect(emptyObject().name).toBeUndefined();
    expect(emptyObject().description).toBeUndefined();
    expect(emptyObject().imageAlt).toBeUndefined();
    // The hostile key is stored as ordinary data on this model alone.
    expect(calendar.content('__proto__').name).toBe('PWNED');
  });

  it.each(HOSTILE_KEYS)('hasContent(%s) is false when nothing was added under that key', (key) => {
    expect(new Calendar('cal-1').hasContent(key)).toBe(false);
  });

  it.each(HOSTILE_KEYS)('addContent then dropContent round-trips under %s', (key) => {
    const calendar = new Calendar('cal-1');

    calendar.addContent(new CalendarContent(key, 'Hostile Key Calendar'));
    expect(calendar.hasContent(key)).toBe(true);
    expect(calendar.getLanguages()).toContain(key);
    expect(calendar.content(key).name).toBe('Hostile Key Calendar');
    expect(emptyObject().name).toBeUndefined();

    calendar.dropContent(key);
    expect(calendar.hasContent(key)).toBe(false);
    expect(calendar.getLanguages()).not.toContain(key);
    expect(Object.getPrototypeOf(calendar._content)).toBeNull();
  });

  it('hasContent is false for an added-but-empty row', () => {
    const calendar = new Calendar('cal-1');
    calendar.addContent(new CalendarContent('en'));
    expect(calendar.hasContent('en')).toBe(false);
  });

  it('still lazily creates and reuses a row for an ordinary language code', () => {
    const calendar = new Calendar('cal-1');
    expect(calendar.getLanguages()).toEqual([]);

    const created = calendar.content('fr');
    expect(created).toBeInstanceOf(CalendarContent);
    expect(created.language).toBe('fr');
    created.name = 'Centre Communautaire';

    // A second call must return the stored row, not a replacement.
    expect(calendar.content('fr')).toBe(created);
    expect(calendar.getLanguages()).toEqual(['fr']);
    expect(calendar.hasContent('fr')).toBe(true);
  });

  // Subclasses must not redeclare `_content`: a subclass field initializer runs
  // after super() and would put a plain object back, silently undoing the
  // hardening for that model alone. One case per subclass so a reintroduced
  // declaration is caught wherever it lands.
  const subclassCases: [string, () => TranslatedModel<TranslatedContentModel>][] = [
    ['Calendar', () => new Calendar('cal-1')],
    ['CalendarEvent', () => new CalendarEvent('evt-1', 'cal-1')],
    ['EventSeries', () => new EventSeries('ser-1', 'cal-1')],
    ['EventCategory', () => new EventCategory('cat-1', 'cal-1')],
    ['EventLocation', () => new EventLocation('loc-1')],
    ['EventLocationSpace', () => new EventLocationSpace('spc-1', 'loc-1')],
  ];

  it.each(subclassCases)('%s inherits the null-prototype content map', (_name, build) => {
    const model = build();
    expect(Object.getPrototypeOf(model._content)).toBeNull();
    model.content('__proto__').name = 'PWNED';
    expect(emptyObject().name).toBeUndefined();
  });
});
