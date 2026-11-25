import { describe, it, expect } from 'vitest';

import { EventLocation } from '@/common/model/location';
import { escapeIcsText, foldLine, formatLocation } from '@/common/utils/ics-text';

const octets = (text: string) => new TextEncoder().encode(text).length;

function makeLocation(): EventLocation {
  return new EventLocation('loc-1', 'City Hall', '100 Main St', 'Springfield', 'IL', '62701');
}

describe('escapeIcsText', () => {
  it('escapes backslash, semicolon and comma', () => {
    expect(escapeIcsText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
  });

  it('writes every line-break form as a literal \\n', () => {
    expect(escapeIcsText('one\r\ntwo\rthree\nfour')).toBe('one\\ntwo\\nthree\\nfour');
  });

  it('escapes the backslash before the characters it introduces', () => {
    expect(escapeIcsText('\\n')).toBe('\\\\n');
  });

  it('leaves colons and quotes alone', () => {
    expect(escapeIcsText('Talk: "Bees"')).toBe('Talk: "Bees"');
  });
});

describe('foldLine', () => {
  it('returns a line of exactly 75 octets unchanged', () => {
    const line = 'SUMMARY:' + 'a'.repeat(67);

    expect(octets(line)).toBe(75);
    expect(foldLine(line)).toBe(line);
  });

  it('folds a 76-octet line into a 75-octet line and a continuation', () => {
    const line = 'SUMMARY:' + 'a'.repeat(68);

    expect(foldLine(line)).toBe('SUMMARY:' + 'a'.repeat(67) + '\r\n a');
  });

  it('keeps every physical line within 75 octets, continuation space included', () => {
    const physical = foldLine('DESCRIPTION:' + 'x'.repeat(400)).split('\r\n');

    expect(physical.length).toBeGreaterThan(5);
    for (const part of physical) {
      expect(octets(part)).toBeLessThanOrEqual(75);
    }
    for (const part of physical.slice(1)) {
      expect(part.startsWith(' ')).toBe(true);
    }
  });

  it('never splits a multi-byte character, and unfolds to the original text', () => {
    // é is two octets, 日 three, and the emoji four (a surrogate pair in UTF-16)
    const line = 'SUMMARY:' + 'é日😀'.repeat(40);
    const folded = foldLine(line);

    for (const part of folded.split('\r\n')) {
      expect(octets(part)).toBeLessThanOrEqual(75);
      expect(part).not.toContain('�');
    }
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });
});

describe('formatLocation', () => {
  it('joins name, address and the city line', () => {
    expect(formatLocation(makeLocation())).toBe('City Hall, 100 Main St, Springfield, IL 62701');
  });

  it('places a space name after the place name', () => {
    expect(formatLocation(makeLocation(), 'Council Chamber'))
      .toBe('City Hall, Council Chamber, 100 Main St, Springfield, IL 62701');
  });

  it('ignores an empty space name', () => {
    expect(formatLocation(makeLocation(), '')).toBe('City Hall, 100 Main St, Springfield, IL 62701');
  });

  it('leads with the space name when the place has no name', () => {
    const location = makeLocation();
    location.name = '';

    expect(formatLocation(location, 'Room 2')).toBe('Room 2, 100 Main St, Springfield, IL 62701');
  });

  it('omits the parts a location does not have', () => {
    expect(formatLocation(new EventLocation('loc-2', 'The Park'))).toBe('The Park');
    expect(formatLocation(new EventLocation('loc-3', '', '5 Elm St', 'Dover'))).toBe('5 Elm St, Dover');
  });
});
