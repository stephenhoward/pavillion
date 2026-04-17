/**
 * Shared test helpers for integration tests.
 *
 * Provides mock factories for RunLogger, OrchestratorContext, and a
 * ScriptRouter that maps script paths to fixture JSON + exit codes.
 * Also provides a DispatchRouter for mapping agent names to fixture
 * JSON responses.
 *
 * These helpers avoid real I/O — every shell invocation and claude
 * dispatch is intercepted and answered from fixture data.
 */

import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpawnSyncReturns } from 'node:child_process';
import { PhaseName, type RunLogger } from '../../lib/types.js';
import type { OrchestratorCtx } from '../../process-backlog.js';

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');

/**
 * Load a fixture file and return its parsed JSON content.
 */
export function loadFixture<T = unknown>(relativePath: string): T {
  const raw = readFileSync(join(FIXTURES_DIR, relativePath), 'utf-8');
  return JSON.parse(raw) as T;
}

// ---------------------------------------------------------------------------
// Stub logger
// ---------------------------------------------------------------------------

export interface StubLogger extends RunLogger {
  runJsonEntries: Record<string, unknown>[];
  phaseLogEntries: Array<{ phase: PhaseName; kind: string; data: string }>;
}

export function stubLogger(): StubLogger {
  const runJsonEntries: Record<string, unknown>[] = [];
  const phaseLogEntries: Array<{ phase: PhaseName; kind: string; data: string }> = [];
  return {
    writePhaseLog: vi.fn((phase: PhaseName, kind: string, data: string) => {
      phaseLogEntries.push({ phase, kind, data });
    }),
    appendRunJson(entry: Record<string, unknown>) {
      runJsonEntries.push(entry);
    },
    runDir: () => '/tmp/fake-integration-run',
    runJsonEntries,
    phaseLogEntries,
  };
}

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

export function makeCtx(overrides: Partial<OrchestratorCtx> = {}): OrchestratorCtx {
  return {
    runId: 'integration-test-001',
    beadId: '',
    logger: stubLogger(),
    phaseHistory: [],
    dryRun: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Script router — maps (scriptPath, args) to fixture responses
// ---------------------------------------------------------------------------

export interface ScriptResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * A ScriptRouter maps script path substrings to response factories.
 * When a spawnSync call matches a route, the route's factory is called
 * with the args array and returns a mock SpawnSyncReturns.
 */
export type ScriptRouteHandler = (args: string[]) => ScriptResponse;

export class ScriptRouter {
  private routes: Array<{ pattern: string; handler: ScriptRouteHandler }> = [];
  public calls: Array<{ cmd: string; args: string[] }> = [];

  /**
   * Register a route. `pattern` is matched as a substring against the
   * command string (first arg to spawnSync).
   */
  on(pattern: string, handler: ScriptRouteHandler): this {
    this.routes.push({ pattern, handler });
    return this;
  }

  /**
   * Register a route that returns a fixed fixture file.
   */
  onFixture(pattern: string, fixturePath: string, exitCode = 0): this {
    const raw = readFileSync(join(FIXTURES_DIR, fixturePath), 'utf-8');
    return this.on(pattern, () => ({
      exitCode,
      stdout: raw,
      stderr: '',
    }));
  }

  /**
   * Create a spawnSync-compatible function that routes through this router.
   */
  toSpawnFn(): (...spawnArgs: unknown[]) => SpawnSyncReturns<Buffer> {
    return (cmd: unknown, args: unknown, _opts: unknown): SpawnSyncReturns<Buffer> => {
      const cmdStr = String(cmd);
      const argsArr = Array.isArray(args) ? args.map(String) : [];

      this.calls.push({ cmd: cmdStr, args: argsArr });

      for (const route of this.routes) {
        if (cmdStr.includes(route.pattern)) {
          const response = route.handler(argsArr);
          return {
            stdout: Buffer.from(response.stdout),
            stderr: Buffer.from(response.stderr),
            status: response.exitCode,
            signal: null,
            pid: 0,
            output: [null, Buffer.from(response.stdout), Buffer.from(response.stderr)],
          };
        }
      }

      // Unmatched: return exit 0 with empty stdout (safe default)
      return {
        stdout: Buffer.from(''),
        stderr: Buffer.from(`[mock] unmatched command: ${cmdStr} ${argsArr.join(' ')}`),
        status: 0,
        signal: null,
        pid: 0,
        output: [null, Buffer.from(''), Buffer.from('')],
      };
    };
  }

  /**
   * Create an existsFn that always returns true (scripts exist in mock).
   */
  toExistsFn(): (path: string) => boolean {
    return () => true;
  }
}

// ---------------------------------------------------------------------------
// Dispatch router — maps agent names to fixture JSON responses
// ---------------------------------------------------------------------------

export type DispatchRouteHandler = (prompt: string) => unknown;

export class DispatchRouter {
  private routes: Array<{ agent: string; handler: DispatchRouteHandler }> = [];
  public calls: Array<{ agent: string; prompt: string }> = [];

  /**
   * Register a route for an agent name.
   */
  on(agent: string, handler: DispatchRouteHandler): this {
    this.routes.push({ agent, handler });
    return this;
  }

  /**
   * Register a route that returns a fixed fixture file.
   */
  onFixture(agent: string, fixturePath: string): this {
    const data = loadFixture(fixturePath);
    return this.on(agent, () => data);
  }

  /**
   * Create a dispatch-compatible async function.
   */
  toDispatchFn(): (opts: { agent: string; prompt: string }) => Promise<unknown> {
    return async (opts: { agent: string; prompt: string }): Promise<unknown> => {
      this.calls.push({ agent: opts.agent, prompt: opts.prompt });

      for (const route of this.routes) {
        if (opts.agent === route.agent) {
          return route.handler(opts.prompt);
        }
      }

      // Unmatched agent: return empty object
      return {};
    };
  }
}
