import { describe, it, expect } from 'vitest';
import { seriesSaveErrorKey } from '@/client/composables/seriesSaveErrorKey';
import {
  DuplicateSeriesNameError,
  SeriesUrlNameAlreadyExistsError,
  InvalidSeriesUrlNameError,
} from '@/common/exceptions/series';

describe('seriesSaveErrorKey', () => {
  it('maps a duplicate name error', () => {
    expect(seriesSaveErrorKey(new DuplicateSeriesNameError(), true)).toBe('error_duplicate_name');
  });

  it('maps a duplicate url name error', () => {
    expect(seriesSaveErrorKey(new SeriesUrlNameAlreadyExistsError(), true)).toBe('error_duplicate_url_name');
  });

  it('maps an invalid url name error', () => {
    expect(seriesSaveErrorKey(new InvalidSeriesUrlNameError(), true)).toBe('error_invalid_url_name');
  });

  it('falls back to the create error for an unknown error on a new series', () => {
    expect(seriesSaveErrorKey(new Error('boom'), true)).toBe('error_create_series');
  });

  it('falls back to the update error for an unknown error on an existing series', () => {
    expect(seriesSaveErrorKey(new Error('boom'), false)).toBe('error_update_series');
  });
});
