/**
 * Content-based image type detection for the upload allowlist.
 *
 * The client-declared Content-Type is trivially spoofable, so the upload
 * path identifies the file from its leading bytes and treats that result as
 * authoritative. Only the formats the media allowlist can contain are
 * recognised; anything else returns null and is rejected upstream.
 */

export type DetectedImageType = 'image/png' | 'image/jpeg' | 'image/heic';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

// ISO BMFF files open with a box whose type ("ftyp") sits at offset 4 and
// whose major brand sits at offset 8.
const ISO_BMFF_FTYP_OFFSET = 4;
const ISO_BMFF_BRAND_OFFSET = 8;
const ISO_BMFF_BRAND_LENGTH = 4;
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);

const startsWith = (buffer: Buffer, signature: Buffer): boolean =>
  buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);

const isHeic = (buffer: Buffer): boolean => {
  if (buffer.length < ISO_BMFF_BRAND_OFFSET + ISO_BMFF_BRAND_LENGTH) {
    return false;
  }
  const boxType = buffer.toString('ascii', ISO_BMFF_FTYP_OFFSET, ISO_BMFF_BRAND_OFFSET);
  if (boxType !== 'ftyp') {
    return false;
  }
  const brand = buffer.toString('ascii', ISO_BMFF_BRAND_OFFSET, ISO_BMFF_BRAND_OFFSET + ISO_BMFF_BRAND_LENGTH);
  return HEIC_BRANDS.has(brand);
};

/**
 * Returns the MIME type implied by the buffer's magic bytes, or null when the
 * content is not one of the recognised image formats.
 */
export function detectImageType(buffer: Buffer): DetectedImageType | null {
  if (startsWith(buffer, PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (startsWith(buffer, JPEG_SIGNATURE)) {
    return 'image/jpeg';
  }
  if (isHeic(buffer)) {
    return 'image/heic';
  }
  return null;
}
