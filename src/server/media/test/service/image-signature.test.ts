import { describe, it, expect } from 'vitest';
import { detectImageType } from '@/server/media/service/image-signature';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const heicWithBrand = (brand: string): Buffer => Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftyp', 'ascii'),
  Buffer.from(brand, 'ascii'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
]);

describe('detectImageType', () => {
  it('detects PNG from its signature', () => {
    expect(detectImageType(png)).toBe('image/png');
  });

  it('detects JPEG from its signature', () => {
    expect(detectImageType(jpeg)).toBe('image/jpeg');
  });

  it.each(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'])('detects HEIC with ftyp brand %s', (brand) => {
    expect(detectImageType(heicWithBrand(brand))).toBe('image/heic');
  });

  it('returns null for an ISO BMFF file with a non-HEIC brand', () => {
    expect(detectImageType(heicWithBrand('isom'))).toBeNull();
  });

  it('returns null for text that merely claims to be an image', () => {
    expect(detectImageType(Buffer.from('fake png data'))).toBeNull();
  });

  it('returns null for a GIF, which is not in the supported set', () => {
    expect(detectImageType(Buffer.from('GIF89a\x00\x00\x00\x00\x00\x00', 'latin1'))).toBeNull();
  });

  it('returns null for an HTML document', () => {
    expect(detectImageType(Buffer.from('<!DOCTYPE html><html></html>'))).toBeNull();
  });

  it('returns null for an empty or truncated buffer', () => {
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(png.subarray(0, 3))).toBeNull();
    expect(detectImageType(jpeg.subarray(0, 2))).toBeNull();
  });
});
