import { describe, it, expect } from 'vitest';
import { UserProfileResponse } from '@/server/activitypub/model/userprofile';

describe('UserProfileResponse', () => {
  it('declares the calendar public page as the actor document `url`', () => {
    const actorDocument = new UserProfileResponse('test-calendar', 'pavillion.dev').toObject();

    expect(actorDocument.url).toBe('https://pavillion.dev/test-calendar');
  });

  /**
   * A peer host-pins a declared `url` to the host of the actor URI it fetched
   * (see `sanitizePeerPageUrl`), so a `url` on any other host would be dropped
   * and the peer would fall back to guessing our route shape.
   */
  it('declares the page URL on the same host as the actor id', () => {
    const actorDocument = new UserProfileResponse('test-calendar', 'pavillion.dev').toObject();

    expect(new URL(actorDocument.url).host).toBe(new URL(actorDocument.id).host);
  });

  it('keeps the existing actor properties alongside `url`', () => {
    const actorDocument = new UserProfileResponse('test-calendar', 'pavillion.dev', 'TEST_KEY').toObject();

    expect(actorDocument.id).toBe('https://pavillion.dev/calendars/test-calendar');
    expect(actorDocument.type).toBe('Organization');
    expect(actorDocument.preferredUsername).toBe('test-calendar');
    expect(actorDocument.inbox).toBe('https://pavillion.dev/calendars/test-calendar/inbox');
    expect(actorDocument.outbox).toBe('https://pavillion.dev/calendars/test-calendar/outbox');
    expect(actorDocument.publicKey.publicKeyPem).toBe('TEST_KEY');
  });
});
