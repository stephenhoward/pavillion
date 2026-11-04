import { ValidationError } from '@/common/exceptions/base';

/**
 * Validates the media-transform parameters (focal point and zoom) before they
 * are persisted. `mediaFocalPointX` and `mediaFocalPointY` must be finite
 * numbers in [0,1]; `mediaZoom` must be a finite number >= 1. Values that are
 * undefined or null are skipped (no transform supplied / cleared). Out-of-range
 * or non-numeric inputs are rejected with a {@link ValidationError} whose
 * `fields` map flags the offending input.
 *
 * Shared by the event and series create and update paths so every persistence
 * path enforces the same bounds.
 */
export function validateMediaTransform(eventParams: Record<string, any>): void {
  const checkFocal = (key: 'mediaFocalPointX' | 'mediaFocalPointY') => {
    const value = eventParams[key];
    if (value === undefined || value === null) return;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new ValidationError(`${key} must be a number between 0 and 1`, {
        [key]: ['must be a number between 0 and 1'],
      });
    }
  };
  checkFocal('mediaFocalPointX');
  checkFocal('mediaFocalPointY');

  const zoom = eventParams.mediaZoom;
  if (zoom !== undefined && zoom !== null) {
    if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < 1) {
      throw new ValidationError('mediaZoom must be a number greater than or equal to 1', {
        mediaZoom: ['must be a number greater than or equal to 1'],
      });
    }
  }
}
