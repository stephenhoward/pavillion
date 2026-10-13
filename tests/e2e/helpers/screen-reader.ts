/**
 * Thin re-export of the Playwright screen-reader helper for use from e2e
 * specs. Establishes `tests/e2e/helpers/screen-reader.ts` as the canonical
 * import path so individual specs do not reach into `src/common/test-utils/`
 * via deep relative paths. The implementation lives in
 * `src/common/test-utils/screen-reader.ts` and is shared with the Vitest
 * variant.
 */
export { pageScreenReader, type ScreenReaderHandle } from '@/common/test-utils/screen-reader';
