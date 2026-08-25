import { describe, it, expect } from 'vitest';

import { formatBytes } from '@/common/utils/format-bytes';

describe('formatBytes', () => {
  it('formats zero bytes', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
  });

  it('formats sub-kilobyte sizes in bytes', () => {
    expect(formatBytes(1)).toBe('1 Bytes');
    expect(formatBytes(512)).toBe('512 Bytes');
    expect(formatBytes(1023)).toBe('1023 Bytes');
  });

  it('formats kilobyte sizes using 1024-based steps', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabyte sizes and trims trailing zeros', () => {
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatBytes(1.25 * 1024 * 1024)).toBe('1.25 MB');
  });

  it('formats gigabyte sizes', () => {
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3 GB');
  });

  it('rounds to at most two decimal places', () => {
    // 1234567 bytes = 1.17738... MB
    expect(formatBytes(1234567)).toBe('1.18 MB');
  });
});
