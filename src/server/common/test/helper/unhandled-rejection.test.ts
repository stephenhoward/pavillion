import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  installUnhandledRejectionHandler,
  logUnhandledRejection,
} from '@/server/common/helper/unhandled-rejection';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const FIXTURE = path.join(REPO_ROOT, 'src/server/common/test/helper/fixtures/unhandled-rejection-child.ts');

type ChildResult = { code: number | null; stdout: string; stderr: string };

/**
 * Runs the fixture under tsx in a fresh Node process. The rejection has to
 * happen out of process: vitest registers its own unhandledRejection
 * listener and would report the fixture's rejection as a test error.
 */
function runFixture(): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', FIXTURE], {
      cwd: REPO_ROOT,
      env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'error' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('installUnhandledRejectionHandler', () => {
  afterEach(() => {
    process.off('unhandledRejection', logUnhandledRejection);
  });

  it('registers the listener once across repeated installs', () => {
    const before = process.listenerCount('unhandledRejection');

    installUnhandledRejectionHandler();
    installUnhandledRejectionHandler();

    expect(process.listenerCount('unhandledRejection')).toBe(before + 1);
  });

  it('logs the rejection with its stack at error level and keeps the process up', async () => {
    const { code, stdout, stderr } = await runFixture();

    expect(stderr).toBe('');
    expect(code).toBe(0);

    const lines = stdout.trim().split('\n');
    const logEntries = lines
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line));

    expect(logEntries).toHaveLength(1);
    expect(logEntries[0]).toMatchObject({
      level: 50,
      msg: 'Unhandled promise rejection',
      err: { type: 'Error', message: 'fixture rejection' },
    });
    expect(logEntries[0].err.stack).toContain('unhandled-rejection-child.ts');
    expect(lines[lines.length - 1]).toBe('still-alive');
  }, 20000);
});
