/**
 * Agent-facing CLI for `/spawn-bead-workers --scheduled`: the deterministic
 * half of the run. JSON to stdout, except `state-write`, which prints the
 * bd update flags for inspection. Runs from the repository root wherever
 * it is invoked.
 *
 * Usage:
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts validate-flags <argv…>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts preflight --owner-pid <pid>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts release --run <id>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts gates [--queue-only]
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts select
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts build-state <root-id>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts still-ours <root-id>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts validate-prs <root-id> [--text]
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts write <root-id> --run <id> [--label <spec:label>] [--state-file <json>] [--firing <kind>] [--stall-step <step> --stall-file <file>]
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts state-write <spec:building|spec:built|spec:stalled>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts dry-run
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts pr-text-check <file|->
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts submit-check <root-id> --leaf <id> --base <branch>
 *   npx tsx .agents/skills/build-scheduled/scripts/build.ts publish-pr <root-id> <pr> --leaf <id> --title-file <f> --body-file <f>
 *
 * Exit codes: 0 ok, 1 a refused flag set / failed check / malformed block /
 * refused write, 2 usage or an unexpected error.
 *
 * Operator-facing flow: .agents/skills/build-scheduled/SKILL.md
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  type LockStore,
  LOCK_PATH,
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
  prTextCheck,
  runPublishPr,
  runSubmitCheck,
} from './lib/build.js';

const USAGE = `usage: build.ts <command> [args]

commands:
  validate-flags <argv…>        exit 1 + message on a refused flag combination
  preflight --owner-pid <pid>   report path, lock, clean tree; takes the lock and prints
                                this run's id as "run" (JSON). Pass $PPID: the lock goes
                                stale once that process exits
  release --run <id>            remove the lock if this run holds it (JSON)
  gates [--queue-only]          each gate's reading and verdict, in order (JSON)
  select                        selected root, ordering source, skipped roots (JSON)
  build-state <root-id>         last Build state block, start decision, resume point and
                                next_state, the next write's state file (JSON); exit 1
                                means stall the root
  still-ours <root-id>          the kill switch over a fresh read of the root (JSON); exit 1 = stop
  validate-prs <root-id> [--text]
                                every recorded PR against gh pr view (JSON); exit 1 = stall.
                                --text also checks each PR's published title, body and
                                branch (the post-submit check before spec:built)
  write <root-id> --run <id> [--label <spec:label>] [--state-file <json>]
        [--firing <kind>] [--stall-step <step> --stall-file <file>]
                                the one write path: refuses unless the lock is this
                                run's, takes chains and stopped from the state file,
                                derives firings and restart from the notes, guards,
                                then one bd update --append-notes. <kind>:
                                building, ended, gate-skipped, dry-run,
                                decision-blocked, kill-switch.
                                <step>: preflight, gates, build-state, validate-prs,
                                firing-limit, sweep, text-check, or
                                chain <k> level <n> implement|audit|build-gate|submit
  state-write <spec:label>      the bd update flags for spec:building, spec:built or spec:stalled
  dry-run                       preflight, gates, selection, chain plan, label write; writes nothing (JSON)
  pr-text-check <file|->        a candidate PR title, body, branch name or commit log (- reads
                                stdin) against the publication patterns (JSON); exit 1 = publish nothing
  submit-check <root-id> --leaf <id> --base <branch>
                                before stack.ts submit, in the level's checkout: security
                                hold, text check over the branch name and base..HEAD
                                commits, kill switch (JSON); exit 1 = submit nothing,
                                "hold": true = stall the level unsubmitted
  publish-pr <root-id> <pr> --leaf <id> --title-file <f> --body-file <f>
                                the one way to set a PR's title and body: security hold,
                                PR checks, text check over title, body, branch and commits,
                                kill switch, then gh pr edit (JSON); exit 1 = nothing edited,
                                "hold": true = stall the level unsubmitted
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function json(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/**
 * The lock lives in the main checkout whichever worktree a command runs in,
 * so a write from a chain's worktree sees the lock preflight took.
 */
function lockPath(): string {
  const common = execRunner('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (common.exitCode !== 0) fail(`cannot find the main checkout: ${common.stderr}`);
  return resolve(dirname(common.stdout), LOCK_PATH);
}

const fileLock: LockStore = {
  read() {
    try {
      return readFileSync(lockPath(), 'utf-8');
    }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  },
  create(content) {
    const path = lockPath();
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, content, { flag: 'wx' });
      return true;
    }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  },
  overwrite(content) {
    writeFileSync(lockPath(), content);
  },
  remove() {
    rmSync(lockPath(), { force: true });
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
      const result = runPreflight(execRunner, { lock: fileLock, isAlive, ownerPid, run: randomUUID(), now });
      json(result);
      process.exit(result.ok ? 0 : 1);
      break;
    }
    case 'release': {
      const [flag, run] = args;
      if (args.length !== 2 || flag !== '--run' || !run) fail(USAGE);
      const reading = releaseLock(fileLock, run);
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
      const [id, flag] = args;
      if (!id || args.length > 2 || (flag !== undefined && flag !== '--text')) fail(USAGE);
      const result = runValidatePrs(execRunner, id, { text: flag === '--text' });
      json(result);
      process.exit(result.ok ? 0 : 1);
      break;
    }
    case 'write': {
      const [root, ...rest] = args;
      if (!root) fail(USAGE);
      const flags = flagPairs(rest, ['--run', '--label', '--state-file', '--firing', '--stall-step', '--stall-file']);
      const run = flags.get('--run');
      if (run === undefined) fail(`write takes --run <id from preflight>\n\n${USAGE}`);
      const stalling = flags.get('--label') === 'spec:stalled';
      if (flags.has('--stall-step') !== stalling || flags.has('--stall-file') !== stalling) {
        fail(`spec:stalled takes --stall-step and --stall-file, and nothing else does\n\n${USAGE}`);
      }
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
        firing: flags.get('--firing') ?? null,
        run,
        now,
      }, fileLock);
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
    case 'submit-check': {
      const [root, ...rest] = args;
      if (!root) fail(USAGE);
      const flags = flagPairs(rest, ['--leaf', '--base']);
      if (flags.size !== 2) fail(USAGE);
      const result = runSubmitCheck(execRunner, { root, leaf: flags.get('--leaf') as string, base: flags.get('--base') as string });
      json(result);
      process.exit(result.ok ? 0 : 1);
      break;
    }
    case 'publish-pr': {
      const [root, pr, ...rest] = args;
      if (!root || !pr || !/^[1-9][0-9]*$/.test(pr)) fail(USAGE);
      const flags = flagPairs(rest, ['--leaf', '--title-file', '--body-file']);
      if (flags.size !== 3) fail(USAGE);
      const result = runPublishPr(execRunner, {
        root,
        pr: Number(pr),
        leaf: flags.get('--leaf') as string,
        title: readInput(flags.get('--title-file') as string),
        body: readInput(flags.get('--body-file') as string),
      });
      json(result);
      process.exit(result.ok ? 0 : 1);
      break;
    }
    case 'pr-text-check': {
      const [source] = args;
      if (!source || args.length > 1) fail(USAGE);
      const matches = prTextCheck(source === '-' ? readFileSync(0, 'utf-8') : readInput(source));
      json({ ok: matches.length === 0, matches });
      process.exit(matches.length ? 1 : 0);
      break;
    }
    default:
      fail(USAGE);
  }
}
catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
