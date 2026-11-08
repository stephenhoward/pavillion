import { describe, it, expect } from 'vitest';
import { stickyQuery } from '@/widget/sticky-query';

describe('stickyQuery', () => {
  it('keeps the color mode, accent and language and drops every other key', () => {
    expect(stickyQuery({
      colorMode: 'dark',
      accentColor: '#77bb41',
      lang: 'es',
      view: 'month',
      date: '2026-05-01',
      categories: 'cat-1',
    })).toEqual({ colorMode: 'dark', accentColor: '#77bb41', lang: 'es' });
  });

  it('omits sticky keys that are absent, null or repeated', () => {
    expect(stickyQuery({ colorMode: null, lang: ['es', 'fr'] })).toEqual({});
  });
});
