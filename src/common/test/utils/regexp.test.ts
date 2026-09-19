import { describe, it, expect } from 'vitest';

import { escapeRegExp } from '@/common/utils/regexp';

describe('escapeRegExp', () => {
  it('leaves a string with no metacharacters unchanged', () => {
    expect(escapeRegExp('calendar-name_1')).toBe('calendar-name_1');
  });

  it('escapes every regular-expression metacharacter', () => {
    expect(escapeRegExp('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });

  it('produces a pattern that matches the input literally', () => {
    const literal = 'a.b*(c)|d';
    const pattern = new RegExp(`^${escapeRegExp(literal)}$`);

    expect(pattern.test(literal)).toBe(true);
    expect(pattern.test('aXb*(c)|d')).toBe(false);
    expect(pattern.test('d')).toBe(false);
  });

  it('keeps each literal whole when joined into an alternation', () => {
    const pattern = new RegExp(`^(?:${['a|b', 'c.d'].map(escapeRegExp).join('|')})$`);

    expect(pattern.test('a|b')).toBe(true);
    expect(pattern.test('c.d')).toBe(true);
    expect(pattern.test('a')).toBe(false);
    expect(pattern.test('cxd')).toBe(false);
  });
});
