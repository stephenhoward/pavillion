/**
 * Agent-facing CLI for `/spawn-bead-workers --scheduled`: the deterministic
 * half of the run. JSON to stdout, except `state-write`, which prints the
 * bd update flags for inspection. Runs from the repository root wherever
 * it is invoked.
 *
 * Usage:
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts validate-flags <argv…>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts preflight --owner-pid <pid>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts release --owner-pid <pid>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts gates [--queue-only]
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts select
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts build-state <root-id>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts still-ours <root-id>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts validate-prs <root-id>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts write <root-id> [--label <spec:label>] [--state-file <json>] [--stall-step <text> --stall-file <file>]
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts state-write <spec:building|spec:built|spec:stalled>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts dry-run
 *
 * Exit codes: 0 ok, 1 a refused flag set / failed check / malformed block /
 * refused write, 2 usage or an unexpected error.
 *
 * Operator-facing flow: .agents/skills/build-scheduled/SKILL.md
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type LockStore,
  LOCK_PATH,
  REPORT_DIR,
  buildStateWriteArgs,
  execRunner,
  readBeads,
  releaseLock,
  runBuildState,
  runDryRun,
  runGates,
  runPreflight,
  runQueueGate,
  runStillOurs,
  runValidatePrs,
  runWrite,
  selectRoot,
  validateFlags,
} from './lib/build.js';

const USAGE = `usage: build.ts <command> [args]

commands:
  validate-flags <argv…>        exit 1 + message on a refused flag combination
  preflight --owner-pid <pid>   report path, lock, clean tree; takes the lock (JSON).
                                Pass $PPID: under the Bash tool that is the agent
                                session, which outlives each short-lived CLI call
  release --owner-pid <pid>     remove the lock if this pid holds it (JSON)
  gates [--queue-only]          each gate's reading and verdict, in order (JSON)
  select                        selected root, ordering source, skipped roots (JSON)
  build-state <root-id>         last Build state block, start decision, resume point (JSON);
                                exit 1 means stall the root
  still-ours <root-id>          the kill switch over a fresh read of the root (JSON); exit 1 = stop
  validate-prs <root-id>        every recorded PR against gh pr view (JSON); exit 1 = stall
  write <root-id> [--label <spec:label>] [--state-file <json>] [--stall-step <text> --stall-file <file>]
                                the one write path: guard, then one bd update --append-notes
  state-write <spec:label>      the bd update flags for spec:building, spec:built or spec:stalled
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
  create(content) {
    mkdirSync(REPORT_DIR, { recursive: true });
    try {
      writeFileSync(LOCK_PATH, content, { flag: 'wx' });
      return true;
    }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  },
  overwrite(content) {
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

function ownerPidArg(args: string[]): number {
  const [flag, pid] = args;
  const ownerPid = Number(pid);
  if (args.length !== 2 || flag !== '--owner-pid' || !Number.isSafeInteger(ownerPid) || ownerPid <= 0) fail(USAGE);
  return ownerPid;
}

/** `--flag value` pairs from a closed set; anything else is a usage error. */
function flagPairs(args: string[], allowed: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = [args[i], args[i + 1]];
    if (!allowed.includes(flag) || value === undefined || flags.has(flag)) fail(USAGE);
    flags.set(flag, value);
  }
  return flags;
}

/** Relative file paths are the caller's, resolved before the chdir to the repo root. */
const callerCwd = process.cwd();

function readInput(path: string): string {
  return readFileSync(resolve(callerCwd, path), 'utf-8');
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
      const ownerPid = ownerPidArg(args);
      const result = runPreflight(execRunner, { lock: fileLock, isAlive, ownerPid, now });
      json(result);
      process.exit(result.ok ? 0 : 1);
      break;
    }
    case 'release': {
      const reading = releaseLock(fileLock, ownerPidArg(args));
      json(reading);
      process.exit(reading.verdict === 'pass' ? 0 : 1);
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
      const result = runBuildState(execRunner, id);
      json(result);
      process.exit(result.ok ? 0 : 1);
      break;
    }
    case 'still-ours': {
      const [id] = args;
      if (!id || args.length > 1) fail(USAGE);
      const result = runStillOurs(execRunner, id);
      json(result);
      process.exit(result.ok ? 0 : 1);
      break;
    }
    case 'validate-prs': {
      const [id] = args;
      if (!id || args.length > 1) fail(USAGE);
      const result = runValidatePrs(execRunner, id);
      json(result);
      process.exit(result.ok ? 0 : 1);
      break;
    }
    case 'write': {
      const [root, ...rest] = args;
      if (!root) fail(USAGE);
      const flags = flagPairs(rest, ['--label', '--state-file', '--stall-step', '--stall-file']);
      if (flags.has('--stall-step') !== flags.has('--stall-file')) fail(USAGE);
      const stateFile = flags.get('--state-file');
      const stallFile = flags.get('--stall-file');
      let state: unknown = null;
      if (stateFile !== undefined) {
        try {
          state = JSON.parse(readInput(stateFile));
        }
        catch {
          fail(`--state-file ${stateFile}: not readable JSON`);
        }
      }
      const result = runWrite(execRunner, {
        root,
        label: flags.get('--label') ?? null,
        state,
        stall: stallFile === undefined ? null : { step: flags.get('--stall-step') as string, report: readInput(stallFile) },
        now,
      });
      json(result);
      process.exit(result.ok ? 0 : 1);
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
      json(runDryRun(execRunner, now));
      break;
    }
    default:
      fail(USAGE);
  }
}
catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
