import { describe, it, expect } from 'vitest';

import { extractObjectId, passesTrustGates } from '@/server/activitypub/service/backfill';

// ---------------------------------------------------------------------------
// extractObjectId
// ---------------------------------------------------------------------------

describe('extractObjectId', () => {
  it('returns the string when the object field is a bare IRI', () => {
    const iri = 'https://remote.example/events/abc';
    expect(extractObjectId(iri)).toBe(iri);
  });

  it('returns the id when the object field is an embedded object with an id', () => {
    const embedded = { id: 'https://remote.example/events/abc', type: 'Event' };
    expect(extractObjectId(embedded)).toBe('https://remote.example/events/abc');
  });

  it('returns null when the object field is an embedded object missing an id', () => {
    expect(extractObjectId({ type: 'Event' })).toBeNull();
  });

  it('returns null for null, undefined, non-string, and non-object inputs', () => {
    expect(extractObjectId(null)).toBeNull();
    expect(extractObjectId(undefined)).toBeNull();
    expect(extractObjectId(42)).toBeNull();
    expect(extractObjectId(true)).toBeNull();
    // Arrays are objects but have no `id` field of string type
    expect(extractObjectId(['https://remote.example/events/abc'])).toBeNull();
    // Object whose `id` is not a string
    expect(extractObjectId({ id: 123 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// passesTrustGates
// ---------------------------------------------------------------------------

// Shared fixtures for the trust-gate branches. The source actor lives on
// `source.example`; the local follower calendar lives on `local.example`.
const sourceActorUri = 'https://source.example/calendars/origin/actor';
const localActorUri = 'https://local.example/calendars/follower/actor';
const ctx = { localActorUri, sourceActorUri };

// Same-origin actor as the source (the normal case).
const sourceActor = sourceActorUri;
// Same-origin alias actor — different path, same origin. Should still pass
// the universal origin gate.
const sourceAliasActor = 'https://source.example/users/alias';
// Different-origin actor — should be rejected by the universal origin gate.
const foreignActor = 'https://attacker.example/users/imposter';

describe('passesTrustGates — universal gates', () => {
  it('returns false when the activity has no actor', () => {
    expect(passesTrustGates({ type: 'Create' }, 'Create', ctx)).toBe(false);
  });

  it('returns false when the actor is not a string', () => {
    expect(passesTrustGates({ actor: 42, type: 'Create' }, 'Create', ctx)).toBe(false);
  });

  it('returns false when the actor URL is malformed', () => {
    expect(passesTrustGates({ actor: 'not-a-url', type: 'Create' }, 'Create', ctx)).toBe(false);
  });

  it('returns false when the source actor URI is malformed', () => {
    const badCtx = { localActorUri, sourceActorUri: 'not-a-url' };
    expect(passesTrustGates({ actor: sourceActor, type: 'Create' }, 'Create', badCtx)).toBe(false);
  });

  it('returns false when the actor origin differs from the source actor origin', () => {
    const activity = {
      actor: foreignActor,
      type: 'Create',
      object: {
        id: 'https://attacker.example/events/abc',
        attributedTo: foreignActor,
      },
    };
    expect(passesTrustGates(activity, 'Create', ctx)).toBe(false);
  });

  it('returns false when the loop guard trips (embedded object attributedTo == localActorUri)', () => {
    const activity = {
      actor: sourceActor,
      type: 'Create',
      object: {
        id: 'https://source.example/events/abc',
        attributedTo: localActorUri,
      },
    };
    expect(passesTrustGates(activity, 'Create', ctx)).toBe(false);
  });

  it('returns false for unknown / unsupported activity types', () => {
    const activity = {
      actor: sourceActor,
      type: 'Like',
      object: 'https://source.example/events/abc',
    };
    expect(passesTrustGates(activity, 'Like', ctx)).toBe(false);
  });
});

describe('passesTrustGates — Create', () => {
  it('returns true for an embedded object whose attributedTo matches the actor', () => {
    const activity = {
      actor: sourceActor,
      type: 'Create',
      object: {
        id: 'https://source.example/events/abc',
        attributedTo: sourceActor,
      },
    };
    expect(passesTrustGates(activity, 'Create', ctx)).toBe(true);
  });

  it('returns false for an embedded object whose attributedTo does not match the actor', () => {
    const activity = {
      actor: sourceActor,
      type: 'Create',
      object: {
        id: 'https://source.example/events/abc',
        attributedTo: 'https://source.example/users/someone-else',
      },
    };
    expect(passesTrustGates(activity, 'Create', ctx)).toBe(false);
  });

  it('returns true for a bare IRI object whose hostname matches the actor', () => {
    const activity = {
      actor: sourceActor,
      type: 'Create',
      object: 'https://source.example/events/abc',
    };
    expect(passesTrustGates(activity, 'Create', ctx)).toBe(true);
  });

  it('returns false for a bare IRI object whose hostname differs from the actor', () => {
    const activity = {
      actor: sourceActor,
      type: 'Create',
      object: 'https://other.example/events/abc',
    };
    expect(passesTrustGates(activity, 'Create', ctx)).toBe(false);
  });

  it('returns false when the bare-IRI object is not a valid URL', () => {
    const activity = {
      actor: sourceActor,
      type: 'Create',
      object: 'not-a-url',
    };
    expect(passesTrustGates(activity, 'Create', ctx)).toBe(false);
  });

  it('returns false when object is missing entirely', () => {
    const activity = {
      actor: sourceActor,
      type: 'Create',
    };
    expect(passesTrustGates(activity, 'Create', ctx)).toBe(false);
  });
});

describe('passesTrustGates — Update', () => {
  it('returns true for an embedded object missing attributedTo (permitted per design)', () => {
    // Some peers omit `attributedTo` on Update activities that carry only a
    // patch; the actor-origin gate on the wrapping activity still applies.
    const activity = {
      actor: sourceActor,
      type: 'Update',
      object: {
        id: 'https://source.example/events/abc',
        name: 'Updated name',
      },
    };
    expect(passesTrustGates(activity, 'Update', ctx)).toBe(true);
  });

  it('returns true for an embedded object whose attributedTo matches the actor', () => {
    const activity = {
      actor: sourceActor,
      type: 'Update',
      object: {
        id: 'https://source.example/events/abc',
        attributedTo: sourceActor,
      },
    };
    expect(passesTrustGates(activity, 'Update', ctx)).toBe(true);
  });

  it('returns false for an embedded object whose attributedTo does not match the actor', () => {
    const activity = {
      actor: sourceActor,
      type: 'Update',
      object: {
        id: 'https://source.example/events/abc',
        attributedTo: 'https://source.example/users/someone-else',
      },
    };
    expect(passesTrustGates(activity, 'Update', ctx)).toBe(false);
  });

  it('returns true for a bare IRI object whose hostname matches the actor', () => {
    const activity = {
      actor: sourceActor,
      type: 'Update',
      object: 'https://source.example/events/abc',
    };
    expect(passesTrustGates(activity, 'Update', ctx)).toBe(true);
  });

  it('returns false for a bare IRI object whose hostname differs from the actor', () => {
    const activity = {
      actor: sourceActor,
      type: 'Update',
      object: 'https://other.example/events/abc',
    };
    expect(passesTrustGates(activity, 'Update', ctx)).toBe(false);
  });
});

describe('passesTrustGates — Announce', () => {
  it('returns true when the actor equals sourceActorUri exactly', () => {
    const activity = {
      actor: sourceActorUri,
      type: 'Announce',
      object: 'https://other.example/events/abc',
    };
    expect(passesTrustGates(activity, 'Announce', ctx)).toBe(true);
  });

  it('returns true when the actor shares an origin with sourceActorUri (alias actor)', () => {
    const activity = {
      actor: sourceAliasActor,
      type: 'Announce',
      object: 'https://other.example/events/abc',
    };
    expect(passesTrustGates(activity, 'Announce', ctx)).toBe(true);
  });

  it('returns false when the actor is on a different origin from sourceActorUri', () => {
    // The universal origin gate rejects this before the Announce-specific
    // branch runs; assert the overall result is false either way.
    const activity = {
      actor: foreignActor,
      type: 'Announce',
      object: 'https://attacker.example/events/abc',
    };
    expect(passesTrustGates(activity, 'Announce', ctx)).toBe(false);
  });
});

describe('passesTrustGates — Undo', () => {
  it('returns true when the actor origin matches the source origin (strict cross-check is dispatch-time)', () => {
    const activity = {
      actor: sourceActor,
      type: 'Undo',
      object: 'https://source.example/announces/abc',
    };
    expect(passesTrustGates(activity, 'Undo', ctx)).toBe(true);
  });

  it('returns true for a same-origin alias actor on Undo', () => {
    const activity = {
      actor: sourceAliasActor,
      type: 'Undo',
      object: 'https://source.example/announces/abc',
    };
    expect(passesTrustGates(activity, 'Undo', ctx)).toBe(true);
  });

  it('returns false when the actor origin differs from the source origin on Undo', () => {
    const activity = {
      actor: foreignActor,
      type: 'Undo',
      object: 'https://attacker.example/announces/abc',
    };
    expect(passesTrustGates(activity, 'Undo', ctx)).toBe(false);
  });
});

describe('passesTrustGates — Delete', () => {
  it('returns true when the actor origin matches the source origin', () => {
    const activity = {
      actor: sourceActor,
      type: 'Delete',
      object: 'https://source.example/events/abc',
    };
    expect(passesTrustGates(activity, 'Delete', ctx)).toBe(true);
  });

  it('returns true for a same-origin alias actor on Delete', () => {
    const activity = {
      actor: sourceAliasActor,
      type: 'Delete',
      object: 'https://source.example/events/abc',
    };
    expect(passesTrustGates(activity, 'Delete', ctx)).toBe(true);
  });

  it('returns false when the actor origin differs from the source origin on Delete', () => {
    const activity = {
      actor: foreignActor,
      type: 'Delete',
      object: 'https://attacker.example/events/abc',
    };
    expect(passesTrustGates(activity, 'Delete', ctx)).toBe(false);
  });
});
