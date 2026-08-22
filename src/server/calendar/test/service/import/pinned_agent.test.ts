import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { Agent } from 'undici';

import { createPinnedAgent } from '@/server/calendar/service/import/pinned_agent';

type LookupFn = (
  hostname: string,
  options: unknown,
  callback: (
    err: NodeJS.ErrnoException | null,
    addressOrAddresses: string | Array<{ address: string; family: number }>,
    family?: number,
  ) => void,
) => void;

/**
 * undici does not expose the connect options an Agent was built with, so
 * the tests pass a subclass that records them on construction.
 */
function captureConnect(pinnedIp: string, timeout: number) {
  let captured: { lookup: LookupFn; timeout: number } | undefined;
  class CapturingAgent extends Agent {
    constructor(opts: ConstructorParameters<typeof Agent>[0]) {
      super(opts);
      captured = (opts as { connect: { lookup: LookupFn; timeout: number } }).connect;
    }
  }
  const agent = createPinnedAgent(pinnedIp, timeout, CapturingAgent);
  if (!captured) throw new Error('connect options were not captured');
  return { agent, connect: captured };
}

describe('createPinnedAgent', () => {
  const agents: Agent[] = [];

  afterEach(async () => {
    await Promise.all(agents.splice(0).map(a => a.close()));
  });

  it('returns an undici Agent with the requested connect timeout', () => {
    const { agent, connect } = captureConnect('198.51.100.7', 4_321);
    agents.push(agent);
    expect(agent).toBeInstanceOf(Agent);
    expect(connect.timeout).toBe(4_321);
  });

  it('answers the positional lookup signature with the pinned IPv4 address', () => {
    const { agent, connect } = captureConnect('198.51.100.7', 1_000);
    agents.push(agent);
    const seen: unknown[] = [];
    connect.lookup('attacker.example', {}, (err, addr, family) => {
      seen.push(err, addr, family);
    });
    expect(seen).toEqual([null, '198.51.100.7', 4]);
  });

  it('answers the `{ all: true }` lookup signature with a pinned address array', () => {
    const { agent, connect } = captureConnect('2001:db8::1', 1_000);
    agents.push(agent);
    const seen: unknown[] = [];
    connect.lookup('attacker.example', { all: true }, (err, addr, family) => {
      seen.push(err, addr, family);
    });
    expect(seen).toEqual([null, [{ address: '2001:db8::1', family: 6 }], undefined]);
  });

  it('is the only pinned-agent implementation used by the import fetchers', () => {
    // Structural tripwire: the DNS-rebinding defence must live in exactly
    // one place. Neither caller may construct its own undici Agent.
    const dir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../service/import',
    );
    for (const file of ['fetcher.ts', 'import_source_service.ts']) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      expect(source, file).toMatch(/import \{ createPinnedAgent \} from '[^']*\/pinned_agent';/);
      expect(source, file).toMatch(/createPinnedAgent\(/);
      expect(source, file).not.toMatch(/new Agent\(/);
    }
  });
});
