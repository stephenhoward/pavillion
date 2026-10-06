import { describe, it, expect } from 'vitest';
import config from 'config';

import { publicOrigin, publicUrl } from '@/server/common/helper/public-url';

describe('publicUrl', () => {
  it('prefixes a root-relative path with the https instance origin', () => {
    expect(publicUrl('/auth/login')).toBe(`https://${config.get('domain')}/auth/login`);
  });

  it('throws when the path is not root-relative', () => {
    expect(() => publicUrl('auth/login')).toThrow('root-relative');
  });
});

describe('publicOrigin', () => {
  it('returns the https origin with no trailing slash', () => {
    expect(publicOrigin()).toBe(`https://${config.get('domain')}`);
    expect(publicOrigin().endsWith('/')).toBe(false);
  });
});
