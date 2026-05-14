/**
 * Thin re-export of the Playwright screen-reader helper for use from e2e
 * specs. Establishes `tests/e2e/helpers/screen-reader.ts` as the canonical
 * import path so individual specs do not reach into `src/common/test-utils/`
 * via deep relative paths. The implementation lives in
 * `src/common/test-utils/screen-reader.ts` and is shared with the Vitest
 * variant.
 *
 * Design reference:
 *   `docs/superpowers/specs/2026-05-13-screen-reader-testing-design.md`
 *   § Phase 2 (helpers/screen-reader.ts).
 */
export { pageScreenReader, type ScreenReaderHandle } from '../../../src/common/test-utils/screen-reader';
