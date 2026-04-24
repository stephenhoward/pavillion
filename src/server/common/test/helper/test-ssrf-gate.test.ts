import { describe, it, expect, afterEach } from 'vitest';

import { isLocalhostIcsImportAllowed } from '@/server/common/helper/test-ssrf-gate';

/**
 * Gate-helper unit tests. These assert three invariants:
 *
 *   1. With no env var set, the gate is closed (returns false).
 *   2. With ALLOW_LOCALHOST_ICS_IMPORT=true AND NODE_ENV=production,
 *      the gate stays closed — this is the production-safety guardrail.
 *   3. With ALLOW_LOCALHOST_ICS_IMPORT=true AND NODE_ENV=test (or 'e2e'),
 *      the gate opens.
 *
 * NOTE: the test runner already sets NODE_ENV=test. To test the closed-gate
 * case against NODE_ENV=production we must mutate BOTH env vars together,
 * then restore from the captured originals in afterEach. Uses direct
 * process.env mutation to match the existing pattern in
 * ip-validation.test.ts (ALLOW_PRIVATE_FEDERATION bypass block).
 */
describe('isLocalhostIcsImportAllowed', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFlag = process.env.ALLOW_LOCALHOST_ICS_IMPORT;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalFlag === undefined) {
      delete process.env.ALLOW_LOCALHOST_ICS_IMPORT;
    }
    else {
      process.env.ALLOW_LOCALHOST_ICS_IMPORT = originalFlag;
    }
  });

  it('returns false when the env var is unset (gate closed by default)', () => {
    delete process.env.ALLOW_LOCALHOST_ICS_IMPORT;
    process.env.NODE_ENV = 'test';

    expect(isLocalhostIcsImportAllowed()).toBe(false);
  });

  it('returns false when ALLOW_LOCALHOST_ICS_IMPORT is any value other than exactly "true"', () => {
    process.env.NODE_ENV = 'test';

    process.env.ALLOW_LOCALHOST_ICS_IMPORT = '';
    expect(isLocalhostIcsImportAllowed()).toBe(false);

    process.env.ALLOW_LOCALHOST_ICS_IMPORT = 'false';
    expect(isLocalhostIcsImportAllowed()).toBe(false);

    process.env.ALLOW_LOCALHOST_ICS_IMPORT = '1';
    expect(isLocalhostIcsImportAllowed()).toBe(false);

    process.env.ALLOW_LOCALHOST_ICS_IMPORT = 'TRUE';
    expect(isLocalhostIcsImportAllowed()).toBe(false);
  });

  it('returns false when NODE_ENV=production even if ALLOW_LOCALHOST_ICS_IMPORT=true (production safety)', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_LOCALHOST_ICS_IMPORT = 'true';

    expect(isLocalhostIcsImportAllowed()).toBe(false);
  });

  it('returns false for arbitrary non-test/e2e NODE_ENV values even with flag set', () => {
    process.env.ALLOW_LOCALHOST_ICS_IMPORT = 'true';

    for (const env of ['development', 'staging', 'federation', 'integration', '']) {
      process.env.NODE_ENV = env;
      expect(isLocalhostIcsImportAllowed()).toBe(false);
    }
  });

  it('returns true when NODE_ENV=test and ALLOW_LOCALHOST_ICS_IMPORT=true', () => {
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_LOCALHOST_ICS_IMPORT = 'true';

    expect(isLocalhostIcsImportAllowed()).toBe(true);
  });

  it('returns true when NODE_ENV=e2e and ALLOW_LOCALHOST_ICS_IMPORT=true', () => {
    process.env.NODE_ENV = 'e2e';
    process.env.ALLOW_LOCALHOST_ICS_IMPORT = 'true';

    expect(isLocalhostIcsImportAllowed()).toBe(true);
  });
});
