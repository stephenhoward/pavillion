import { describe, it, expect } from 'vitest';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';

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
