import { describe, it, expect } from 'vitest';
import { linkifyText } from '@/common/utils/linkify';

const links = (text: string) => linkifyText(text).filter(s => s.type === 'link');

describe('linkifyText', () => {
  it('returns no segments for empty text', () => {
    expect(linkifyText('')).toEqual([]);
  });

  it('returns a single text segment when there is no URL', () => {
    expect(linkifyText('Just words.')).toEqual([{ type: 'text', text: 'Just words.' }]);
  });

  it('links a URL and keeps surrounding text', () => {
    expect(linkifyText('Tickets: https://example.org/t now')).toEqual([
      { type: 'text', text: 'Tickets: ' },
      { type: 'link', text: 'https://example.org/t', href: 'https://example.org/t' },
      { type: 'text', text: ' now' },
    ]);
  });

  it('links multiple URLs', () => {
    expect(links('a http://one.example and https://two.example/x b')).toHaveLength(2);
  });

  it('trims trailing punctuation from the link', () => {
    const [link] = links('See https://example.org/tickets.');
    expect(link.text).toBe('https://example.org/tickets');
    const all = linkifyText('See https://example.org/tickets.');
    expect(all[all.length - 1]).toEqual({ type: 'text', text: '.' });
  });

  it('excludes an unbalanced closing parenthesis but keeps a balanced one', () => {
    expect(links('(see https://example.org/a)')[0].text).toBe('https://example.org/a');
    expect(links('https://en.example.org/wiki/Foo_(bar)')[0].text).toBe('https://en.example.org/wiki/Foo_(bar)');
  });

  it('preserves newlines in surrounding text', () => {
    const segments = linkifyText('line1\nhttps://example.org\nline3');
    expect(segments.map(s => s.text).join('')).toBe('line1\nhttps://example.org\nline3');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    'https://user:pw@evil.example',
    '"onmouseover=alert(1)',
    'www.example.org',
    'mailto:a@example.org',
    'person@example.org',
    'tel:+15555550100',
  ])('leaves %s as text', (input) => {
    expect(links(input)).toEqual([]);
    expect(linkifyText(input).map(s => s.text).join('')).toBe(input);
  });

  it('stops a URL at a quote or angle bracket', () => {
    const [link] = links('https://example.org/a"onmouseover=x');
    expect(link.href).toBe('https://example.org/a');
  });
});
