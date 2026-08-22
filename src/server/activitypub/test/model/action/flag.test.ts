/**
 * Serialization tests for `FlagActivity`.
 *
 * `published` is the field that broke. `FlagActivity` used to redeclare it as
 * the wire's ISO `string`, contradicting the `Date | null` it inherits from
 * `ActivityPubActivity`. That narrowed the class out of assignability to its
 * own base, which is what let a plain Flag object literal reach the outbox
 * untyped in the first place. The redeclaration is gone and `toObject` /
 * `fromObject` now convert, so the wire↔model boundary needs pinning: a Flag
 * that leaves this instance must carry the same `published` it arrived with,
 * and a malformed one must not serialize `"Invalid Date"` onto the wire.
 */

import { describe, it, expect } from 'vitest';
import FlagActivity from '@/server/activitypub/model/action/flag';

const FLAG_ID = 'https://local.instance/flags/8d2b6a1e-0a3c-4f5b-9c1d-2e3f4a5b6c7d';
const LOCAL_ACTOR_URI = 'https://local.instance/calendars/test-calendar';
const REMOTE_EVENT_IRI = 'https://remote.instance/calendars/origin-calendar/events/event-uuid';

/** The wire form `FlagActivityBuilder` produces on the way out. */
function buildFlagWireObject(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Flag',
    id: FLAG_ID,
    actor: LOCAL_ACTOR_URI,
    to: ['https://remote.instance/calendars/origin-calendar'],
    object: REMOTE_EVENT_IRI,
    content: 'Report description text',
    tag: [{ type: 'Hashtag', name: '#spam' }],
    summary: 'Event report: spam',
    published: '2026-02-10T12:00:00.000Z',
    ...overrides,
  };
}

describe('FlagActivity serialization', () => {

  it('round-trips an ISO published timestamp through fromObject and toObject', () => {
    const activity = FlagActivity.fromObject(buildFlagWireObject());

    expect(activity).not.toBeNull();
    // Held as a Date on the model, matching the base class contract.
    expect(activity!.published).toBeInstanceOf(Date);
    expect(activity!.published!.toISOString()).toBe('2026-02-10T12:00:00.000Z');
    // And re-serialized as the ISO string the wire expects.
    expect(activity!.toObject().published).toBe('2026-02-10T12:00:00.000Z');
  });

  it('round-trips every field the moderation wire form carries', () => {
    const wire = buildFlagWireObject();

    const roundTripped = FlagActivity.fromObject(wire)!.toObject();

    expect(roundTripped).toEqual(wire);
  });

  it('normalizes a non-ISO published value to the same instant', () => {
    const activity = FlagActivity.fromObject(
      buildFlagWireObject({ published: '2026-02-10T12:00:00Z' }),
    );

    expect(activity!.toObject().published).toBe('2026-02-10T12:00:00.000Z');
  });

  it('drops a malformed published rather than emitting "Invalid Date"', () => {
    const activity = FlagActivity.fromObject(
      buildFlagWireObject({ published: 'yesterday afternoon' }),
    );

    // Parsing still succeeds — a bad timestamp does not invalidate the report.
    expect(activity).not.toBeNull();
    expect(activity!.published).toBeNull();
    // The unparseable value must not reach the wire in any form.
    expect(activity!.toObject()).not.toHaveProperty('published');
  });

  it('omits published entirely when the source object has none', () => {
    const wire = buildFlagWireObject();
    delete wire.published;

    const roundTripped = FlagActivity.fromObject(wire)!.toObject();

    expect(roundTripped).not.toHaveProperty('published');
  });
});
