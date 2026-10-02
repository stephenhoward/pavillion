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

  /**
   * Peers cache `url` (as `calendar_actor.page_url`) on machines we do not
   * administer, so a url name must not be able to steer it out of the
   * calendar's own path segment. Stored url names are regex-gated today; this
   * pins the encoding that holds if one is not.
   */
  it.each([
    ['a path separator', 'a/b', 'https://d/a%2Fb'],
    ['a traversal', 'a/../admin', 'https://d/a%2F..%2Fadmin'],
    ['a scheme-relative authority', '//evil.com', 'https://d/%2F%2Fevil.com'],
    ['a query delimiter', 'cal?x=1', 'https://d/cal%3Fx%3D1'],
  ])('percent-encodes %s in the url name rather than emitting it raw', (_label, urlName, expected) => {
    expect(new UserProfileResponse(urlName, 'd').url).toBe(expected);
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
