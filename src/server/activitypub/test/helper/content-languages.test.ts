import { describe, it, expect } from 'vitest';

import { CalendarEventContent } from '@/common/model/events';
import { mappedContentLanguages } from '@/server/activitypub/helper/content-languages';

/**
 * The gate in front of the outbound nameMap/summaryMap/contentMap surfaces.
 * Built from real CalendarEventContent rows rather than literals so that a
 * content field added to the model shows up here as a compile-time fact.
 */
function contentRows(...rows: CalendarEventContent[]): Record<string, CalendarEventContent> {
  return Object.fromEntries(rows.map(r => [r.language, r]));
}

describe('mappedContentLanguages', () => {

  it('counts a language with a name', () => {
    const content = contentRows(new CalendarEventContent('en', 'A Name', ''));

    expect(mappedContentLanguages(content)).toEqual(['en']);
  });

  it('counts a language with only a description', () => {
    const content = contentRows(new CalendarEventContent('en', '', 'A description'));

    expect(mappedContentLanguages(content)).toEqual(['en']);
  });

  it('does not count a language carrying only alt text', () => {
    const content = contentRows(
      new CalendarEventContent('en', 'A Name', 'A description'),
      new CalendarEventContent('es', '', '', '', 'Un gato dormido en un piano'),
    );

    expect(mappedContentLanguages(content)).toEqual(['en']);
  });

  it('does not count a language carrying only accessibilityInfo', () => {
    const content = contentRows(
      new CalendarEventContent('en', 'A Name', 'A description'),
      new CalendarEventContent('es', '', '', 'Rampa disponible'),
    );

    expect(mappedContentLanguages(content)).toEqual(['en']);
  });

  it('counts a language whose name arrives alongside unmapped fields', () => {
    const content = contentRows(
      new CalendarEventContent('en', 'A Name', 'A description'),
      new CalendarEventContent('es', 'Un Nombre', '', 'Rampa disponible', 'Un gato'),
    );

    expect(mappedContentLanguages(content)).toEqual(['en', 'es']);
  });

  it('counts nothing for an entirely empty content set', () => {
    expect(mappedContentLanguages({})).toEqual([]);
    expect(mappedContentLanguages(contentRows(new CalendarEventContent('en')))).toEqual([]);
  });
});
