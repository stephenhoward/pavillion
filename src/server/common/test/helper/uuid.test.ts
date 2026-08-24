import { describe, it, expect } from 'vitest';

import { isValidUuidV4, looksLikeUuid } from '@/server/common/helper/uuid';

const V4 = '550e8400-e29b-41d4-a716-446655440000';
const V1 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const NIL = '00000000-0000-0000-0000-000000000000';
const AP_URL = 'https://remote.example/events/550e8400-e29b-41d4-a716-446655440000';

describe('isValidUuidV4', () => {
  it('accepts v4 UUIDs in either case', () => {
    expect(isValidUuidV4(V4)).toBe(true);
    expect(isValidUuidV4(V4.toUpperCase())).toBe(true);
  });

  it('rejects non-v4 versions and the nil UUID', () => {
    expect(isValidUuidV4(V1)).toBe(false);
    expect(isValidUuidV4(NIL)).toBe(false);
  });

  it('rejects non-string and non-UUID input', () => {
    expect(isValidUuidV4(AP_URL)).toBe(false);
    expect(isValidUuidV4('')).toBe(false);
    expect(isValidUuidV4(null)).toBe(false);
    expect(isValidUuidV4(undefined)).toBe(false);
    expect(isValidUuidV4([V4])).toBe(false);
  });
});

describe('looksLikeUuid', () => {
  it('accepts any version or variant with the 8-4-4-4-12 shape', () => {
    expect(looksLikeUuid(V4)).toBe(true);
    expect(looksLikeUuid(V1)).toBe(true);
    expect(looksLikeUuid(NIL)).toBe(true);
  });

  it('rejects AP URLs and other non-UUID strings', () => {
    expect(looksLikeUuid(AP_URL)).toBe(false);
    expect(looksLikeUuid('not-a-uuid')).toBe(false);
    expect(looksLikeUuid(null)).toBe(false);
  });
});
