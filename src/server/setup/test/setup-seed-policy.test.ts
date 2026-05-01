import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';

// Intercept the shared logger so we can assert that the defensive catch
// blocks log a warning (and never throw) when fs operations fail. The
// factory must return a function that returns a logger-like object —
// the real module exports `createLogger(domain)` which returns a
// pino-ish child. Using vi.hoisted lets us reference the stub in both
// the mock factory and the assertions below.
const { warnStub, readFileMock } = vi.hoisted(() => {
  return {
    warnStub: vi.fn(),
    readFileMock: vi.fn(),
  };
});

vi.mock('@/server/common/helper/logger', () => ({
  createLogger: () => ({
    warn: warnStub,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  default: {
    warn: warnStub,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// fs/promises must be mocked at the module level — sinon cannot stub
// ESM bindings, so we route the implementation's `readFile` through a
// vi.fn() that each test reconfigures. We provide the small surface
// the module graph reaches (readFile, plus a default export that
// mirrors it) rather than spreading actual: on the vmThreads pool used
// by this project, vi.mock factories that lazily call importOriginal()
// of node built-ins are not always honoured.
vi.mock('fs/promises', () => ({
  readFile: readFileMock,
  default: { readFile: readFileMock },
}));

import SetupService from '@/server/setup/service/setup';
import ConfigurationInterface from '@/server/configuration/interface';

/**
 * Tests for SetupService.seedDefaultInstancePolicy — the first-run hook
 * that loads the bundled default instance-policy markdown and routes it
 * through the configuration sanitization pipeline.
 *
 * Defensive contract: this hook MUST NEVER throw, MUST NEVER block setup
 * completion, and MUST NEVER block admin login. All failures (missing
 * file, unreadable file, downstream errors) are caught and logged.
 *
 * The four cases below exercise:
 *  1. No existing policy + file present → seeds policy
 *  2. Existing policy → skips silently (no overwrite)
 *  3. File missing (ENOENT) → warns, no exception, no seed
 *  4. File unreadable (EACCES) → warns, no exception, no seed
 */
describe('SetupService.seedDefaultInstancePolicy', () => {
  const sandbox = sinon.createSandbox();
  let setupService: SetupService;
  let getInstancePolicyStub: sinon.SinonStub;
  let setInstancePolicyStub: sinon.SinonStub;
  let mockConfigInterface: ConfigurationInterface;

  beforeEach(() => {
    getInstancePolicyStub = sinon.stub().resolves({});
    setInstancePolicyStub = sinon.stub().resolves(true);

    mockConfigInterface = {
      getSetting: sinon.stub().resolves(undefined),
      setSetting: sinon.stub().resolves(true),
      getAllSettings: sinon.stub().resolves({}),
      getDefaultLanguage: sinon.stub().resolves('en'),
      getEnabledLanguages: sinon.stub().resolves(['en']),
      getForceLanguage: sinon.stub().resolves(null),
      getInstancePolicy: getInstancePolicyStub,
      setInstancePolicy: setInstancePolicyStub,
    } as unknown as ConfigurationInterface;

    setupService = new SetupService(mockConfigInterface);

    readFileMock.mockReset();
    warnStub.mockClear();
  });

  afterEach(() => {
    sandbox.restore();
    SetupService.clearCache();
  });

  it('seeds the policy when no row has a non-empty policy and the default file is present', async () => {
    const markdownSource = '# Policy\n\nBe excellent.';
    getInstancePolicyStub.resolves({});
    readFileMock.mockResolvedValue(markdownSource);

    await setupService.seedDefaultInstancePolicy();

    // setInstancePolicy is called exactly once with the raw markdown
    // keyed by language. Sanitization happens downstream — the seed
    // hook deliberately does NOT pre-sanitize so the configuration
    // service remains the single source of truth for that pipeline.
    expect(setInstancePolicyStub.calledOnce).toBe(true);
    expect(setInstancePolicyStub.firstCall.args[0]).toEqual({ en: markdownSource });
  });

  it('skips silently when any language already has a non-empty policy', async () => {
    // Operator (or a previous run of this hook) has already set the
    // policy for at least one language. Do not overwrite.
    getInstancePolicyStub.resolves({ en: '<p>existing</p>' });
    readFileMock.mockResolvedValue('# Some default');

    await setupService.seedDefaultInstancePolicy();

    expect(setInstancePolicyStub.called).toBe(false);
  });

  it('logs a warning and does not seed when the default file is missing (ENOENT)', async () => {
    getInstancePolicyStub.resolves({});
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    readFileMock.mockRejectedValue(enoent);

    // Defensive contract: this MUST NOT throw.
    await expect(setupService.seedDefaultInstancePolicy()).resolves.toBeUndefined();

    expect(setInstancePolicyStub.called).toBe(false);
    expect(warnStub).toHaveBeenCalledTimes(1);
  });

  it('logs a warning and does not seed when the default file is unreadable (EACCES)', async () => {
    getInstancePolicyStub.resolves({});
    const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    readFileMock.mockRejectedValue(eacces);

    // Defensive contract: this MUST NOT throw.
    await expect(setupService.seedDefaultInstancePolicy()).resolves.toBeUndefined();

    expect(setInstancePolicyStub.called).toBe(false);
    expect(warnStub).toHaveBeenCalledTimes(1);
  });
});
