import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { VEvent, DateWithTimeZone } from 'node-ical';

import { mapVEvent } from '@/server/calendar/service/import/mapper';

/**
 * Guards the mapper's x_props allowlist against the keys node-ical really
 * emits, not the keys we assume it emits.
 *
 * mapper.test.ts builds VEvent objects by hand, so a wrong belief about the
 * parser's output (e.g. the casing of X-* keys) would be baked into both the
 * mapper and its tests. This test instead feeds the mapper a VEVENT captured
 * from node-ical's `sync.parseICS()` run over fixtures/x-props-allowlist.ics.
 *
 * node-ical cannot be loaded in the vmThreads pool (see
 * fixtures/capture-x-props-fixture.ts), so the parse happens out of band.
 * Regenerate the JSON with that script after a node-ical upgrade.
 */

const FIXTURE_PATH = resolve(__dirname, 'fixtures/x-props-allowlist.vevent.json');

/** Revives the `{ $date, tz }` encoding written by the capture script. */
function loadCapturedVEvent(): VEvent {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'), (_key, value) => {
    if (value && typeof value === 'object' && '$date' in value) {
      const date = new Date(value.$date) as DateWithTimeZone;
      if (value.tz !== undefined) {
        date.tz = value.tz;
      }
      return date;
    }
    return value;
  }) as VEvent;
}

describe('ICS mapper with captured node-ical output', () => {
  it('keeps exactly the allowlisted properties under their stored keys', () => {
    const out = mapVEvent({ vevent: loadCapturedVEvent(), calendarPrimaryLanguage: 'en' });

    expect(Object.keys(out.x_props).sort()).toEqual([
      'X-APPLE-STRUCTURED-LOCATION',
      'categories',
      'conference',
      'geo',
    ]);
    expect(out.x_props.categories).toEqual(['music', 'art']);
    expect(out.x_props.geo).toEqual({ lat: 37.7749, lon: -122.4194 });
    expect(out.x_props['X-APPLE-STRUCTURED-LOCATION']).toEqual({
      val: 'geo:37.7749,-122.4194',
      params: { VALUE: 'URI', 'X-TITLE': 'HQ' },
    });
    expect(out.x_props.conference).toEqual({
      val: 'https://meet.example.test/abc',
      params: { VALUE: 'URI', LABEL: 'Standup' },
    });
  });
});
