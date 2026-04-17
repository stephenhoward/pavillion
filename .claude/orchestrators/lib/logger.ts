/**
 * Per-run log directory management for orchestrator runs.
 *
 * Creates .claude/orchestrators/logs/<run-id>/ on first write and exposes
 * methods to write phase logs and append to the structured run.json trace.
 *
 * No external dependencies — uses only Node built-ins.
 */

import { mkdirSync, appendFileSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PhaseName, type RunLogger } from './context.js';

const LOGS_ROOT = join(dirname(import.meta.url.replace('file://', '')), '..', 'logs');

/**
 * Generate a unique run-id: ISO timestamp (compact) + 4-char hex suffix.
 *
 * Example: `20260416T143022-a1b2`
 */
function generateRunId(): string {
  const now = new Date();
  const ts = now.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', 'T')
    .split('.')[0];
  const suffix = randomBytes(2).toString('hex');
  return `${ts}-${suffix}`;
}

/**
 * Create a RunLogger bound to a specific run-id.
 *
 * The run directory is created lazily on the first write call.
 */
export function createRunLogger(runId?: string): RunLogger & { runId: string } {
  const id = runId ?? generateRunId();
  const dir = join(LOGS_ROOT, id);
  let dirCreated = false;

  function ensureDir(): void {
    if (!dirCreated) {
      mkdirSync(dir, { recursive: true });
      dirCreated = true;
    }
  }

  return {
    runId: id,

    writePhaseLog(phase: PhaseName, kind: 'out' | 'err', data: string): void {
      ensureDir();
      const ext = kind === 'out' ? 'log' : 'err';
      const filePath = join(dir, `${phase}.${ext}`);
      appendFileSync(filePath, data);
    },

    appendRunJson(entry: Record<string, unknown>): void {
      ensureDir();
      const filePath = join(dir, 'run.json');

      let entries: Record<string, unknown>[] = [];
      if (existsSync(filePath)) {
        try {
          entries = JSON.parse(readFileSync(filePath, 'utf-8'));
        }
        catch {
          entries = [];
        }
      }
      entries.push(entry);
      writeFileSync(filePath, JSON.stringify(entries, null, 2) + '\n');
    },

    runDir(): string {
      ensureDir();
      return dir;
    },
  };
}
