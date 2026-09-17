import {
  DuplicateSeriesNameError,
  SeriesUrlNameAlreadyExistsError,
  InvalidSeriesUrlNameError,
} from '@/common/exceptions/series';

/**
 * Map a failed series save to the `series.management` translation key that
 * describes it. Shared by the full-page series editor and the inline
 * create-series modal so both hosts report the same errors.
 */
export function seriesSaveErrorKey(error: unknown, isNew: boolean): string {
  if (error instanceof DuplicateSeriesNameError) return 'error_duplicate_name';
  if (error instanceof SeriesUrlNameAlreadyExistsError) return 'error_duplicate_url_name';
  if (error instanceof InvalidSeriesUrlNameError) return 'error_invalid_url_name';
  return isNew ? 'error_create_series' : 'error_update_series';
}
