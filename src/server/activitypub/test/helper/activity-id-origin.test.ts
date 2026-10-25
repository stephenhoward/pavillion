import { describe, it, expect } from 'vitest';

import { isActivityIdOnOrigin } from '@/server/activitypub/helper/activity-id-origin';

describe('isActivityIdOnOrigin', () => {
  it('accepts an id on the origin host', () => {
    expect(isActivityIdOnOrigin('https://a.example/events/1/delete', 'https://a.example')).toBe(true);
  });

  it('rejects an id on a different host', () => {
    expect(isActivityIdOnOrigin('https://a.example/events/1/delete', 'https://b.example')).toBe(false);
  });

  it('rejects a subdomain of the origin host', () => {
    expect(isActivityIdOnOrigin('https://evil.a.example/x', 'https://a.example')).toBe(false);
  });

  it('treats the port as part of the host', () => {
    expect(isActivityIdOnOrigin('https://a.example:8443/x', 'https://a.example:8443')).toBe(true);
    expect(isActivityIdOnOrigin('https://a.example:8443/x', 'https://a.example')).toBe(false);
  });

  it('compares hosts case-insensitively, as URL parsing normalizes them', () => {
    expect(isActivityIdOnOrigin('https://A.Example/x', 'https://a.example')).toBe(true);
  });

  it('fails closed on a null origin', () => {
    expect(isActivityIdOnOrigin('https://a.example/x', null)).toBe(false);
  });

  it('fails closed when the id or origin does not parse', () => {
    expect(isActivityIdOnOrigin('not a url', 'https://a.example')).toBe(false);
    expect(isActivityIdOnOrigin('https://a.example/x', 'not a url')).toBe(false);
  });
});
