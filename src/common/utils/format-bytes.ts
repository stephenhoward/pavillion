/**
 * Format a byte count as a human-readable size string.
 *
 * Shared helper consolidating the formatters previously duplicated in
 * MediaService, the image-upload component, and the add-import-source
 * form. Uses binary (1024-based) steps with conventional unit labels and
 * trims trailing zeros from the two-decimal rounding ("1.5 KB", "10 MB").
 *
 * Unit labels are intentionally not localized: none of the previous
 * implementations localized them, and the strings are interpolated into
 * translated messages as opaque values.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
