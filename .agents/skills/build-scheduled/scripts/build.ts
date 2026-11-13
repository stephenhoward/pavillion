/**
 * Agent-facing CLI for `/spawn-bead-workers --scheduled`: the deterministic
 * half of the run. JSON to stdout, except `state-write`, which prints the
 * bd update flags ready to append. Runs from the repository root wherever
 * it is invoked.
 *
 * Usage:
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts validate-flags <argv…>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts preflight --owner-pid <pid>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts gates [--queue-only]
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts select
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts build-state <root-id>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts state-write <spec:building|spec:built|spec:stalled>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts dry-run
 *
 * Exit codes: 0 ok, 1 a refused flag set / failed check / malformed block,
 * 2 usage or an unexpected error.
 *
 * Operator-facing flow: .agents/skills/build-scheduled/SKILL.md
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import {
  type LockStore,
  LOCK_PATH,
  REPORT_DIR,
  buildStateWriteArgs,
  execRunner,
  parseBuildState,
  readBead,
  readBeads,
  runDryRun,
  runGates,
  runPreflight,
  runQueueGate,
  selectRoot,
  validateFlags,
} from './lib/build.js';

const USAGE = `usage: build.ts <command> [args]

commands:
  validate-flags <argv…>        exit 1 + message on a refused flag combination
  preflight --owner-pid <pid>   report path, lock, clean tree; takes the lock (JSON)
  gates [--queue-only]          each gate's reading and verdict, in order (JSON)
  select                        selected root, ordering source, skipped roots (JSON)
  build-state <root-id>         parsed last Build state block (JSON); exit 1 if malformed
  state-write <spec:label>      bd update flags for spec:building, spec:built or spec:stalled
  dry-run                       preflight, gates, selection, chain plan, label write; writes nothing (JSON)
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function json(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

const fileLock: LockStore = {
  read() {
    try {
      return readFileSync(LOCK_PATH, 'utf-8');
    }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  },
  write(content) {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(LOCK_PATH, content);
  },
  remove() {
    rmSync(LOCK_PATH, { force: true });
  },
};

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  }
  catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const [command, ...args] = process.argv.slice(2);

try {
  const top = execRunner('git', ['rev-parse', '--show-toplevel']);
  if (top.exitCode !== 0) fail(`not inside a git work tree: ${top.stderr}`);
  process.chdir(top.stdout);
  const now = new Date();

  switch (command) {
    case 'validate-flags': {
      const result = validateFlags(args);
      if (!result.ok) {
        process.stderr.write(`${result.error}\n`);
        process.exit(1);
      }
      json(result);
      break;
    }
    case 'preflight': {
      const [flag, pid] = args;
      const ownerPid = Number(pid);
      if (flag !== '--owner-pid' || !Number.isSafeInteger(ownerPid) || ownerPid <= 0) fail(USAGE);
      const result = runPreflight(execRunner, { lock: fileLock, isAlive, ownerPid, now }, 'run');
      json(result);
      process.exit(result.ok ? 0 : 1);
      break;
    }
    case 'gates': {
      if (args.length > 1 || (args.length === 1 && args[0] !== '--queue-only')) fail(USAGE);
      if (args[0] === '--queue-only') {
        const reading = runQueueGate(execRunner, now);
        json(reading);
        process.exit(reading.verdict === 'pass' ? 0 : 1);
      }
      const result = runGates(execRunner, now, 'run');
      json(result);
      process.exit(result.ok ? 0 : 1);
      break;
    }
    case 'select': {
      if (args.length) fail(USAGE);
      json(selectRoot(readBeads(execRunner)));
      break;
    }
    case 'build-state': {
      const [id] = args;
      if (!id || args.length > 1) fail(USAGE);
      const parsed = parseBuildState(readBead(execRunner, id).notes);
      json(parsed);
      process.exit(parsed.ok ? 0 : 1);
      break;
    }
    case 'state-write': {
      const [label] = args;
      if (!label || args.length > 1) fail(USAGE);
      console.log(buildStateWriteArgs(label).join(' '));
      break;
    }
    case 'dry-run': {
      if (args.length) fail(USAGE);
      json(runDryRun(execRunner, { lock: fileLock, isAlive, ownerPid: process.pid, now }));
      break;
    }
    default:
      fail(USAGE);
  }
}
catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
