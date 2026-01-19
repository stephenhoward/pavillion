import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { isWorkerMode, getAppMode } from '@/server/common/helper/app-mode';

describe('Worker Mode Detection', () => {
  let sandbox: sinon.SinonSandbox;
  let originalArgv: string[];

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // Save original argv
    originalArgv = [...process.argv];
  });

  afterEach(() => {
    // Restore original argv
    process.argv = originalArgv;
    sandbox.restore();
  });

  it('should detect worker mode when --worker flag is present', () => {
    // Add --worker flag to argv
    process.argv = ['node', 'app.js', '--worker'];

    expect(isWorkerMode()).toBe(true);
    expect(getAppMode()).toBe('worker');
  });

  it('should detect web mode when --worker flag is not present', () => {
    // No --worker flag
    process.argv = ['node', 'app.js'];

    expect(isWorkerMode()).toBe(false);
    expect(getAppMode()).toBe('web');
  });

  it('should detect web mode when argv has other flags but not --worker', () => {
    process.argv = ['node', 'app.js', '--verbose', '--debug'];

    expect(isWorkerMode()).toBe(false);
    expect(getAppMode()).toBe('web');
  });

  it('should detect worker mode regardless of flag position', () => {
    process.argv = ['node', 'app.js', '--verbose', '--worker', '--debug'];

    expect(isWorkerMode()).toBe(true);
    expect(getAppMode()).toBe('worker');
  });

  it('should handle edge case with --worker in middle of other arguments', () => {
    process.argv = ['node', 'app.js', '--config=test', '--worker', '--port=3000'];

    expect(isWorkerMode()).toBe(true);
    expect(getAppMode()).toBe('worker');
  });
});
