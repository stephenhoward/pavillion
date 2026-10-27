import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import https from 'https';
import { Agent } from 'undici';

import {
  createPinnedAgent,
  createPinnedHttpsAgent,
  type PinnedLookup,
} from '@/server/common/helper/pinned-agent';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * undici does not expose the connect options an Agent was built with, so
 * the tests pass a subclass that records them on construction.
 */
function captureConnect(pinnedIp: string, timeout: number) {
  let captured: { lookup: PinnedLookup; timeout: number } | undefined;
  class CapturingAgent extends Agent {
    constructor(opts: ConstructorParameters<typeof Agent>[0]) {
      super(opts);
      captured = (opts as { connect: { lookup: PinnedLookup; timeout: number } }).connect;
    }
  }
  const agent = createPinnedAgent(pinnedIp, timeout, CapturingAgent);
  if (!captured) throw new Error('connect options were not captured');
  return { agent, connect: captured };
}

function httpsLookup(agent: https.Agent): PinnedLookup {
  return (agent as unknown as { options: { lookup: PinnedLookup } }).options.lookup;
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
});

describe('createPinnedHttpsAgent', () => {
  it('returns a non-keep-alive https.Agent with the requested timeout', () => {
    const agent = createPinnedHttpsAgent('198.51.100.7', 4_321);
    expect(agent).toBeInstanceOf(https.Agent);
    expect(agent.options.timeout).toBe(4_321);
    expect(agent.options.keepAlive).toBe(false);
  });

  it('answers the positional lookup signature with the pinned IPv4 address', () => {
    const lookup = httpsLookup(createPinnedHttpsAgent('198.51.100.7', 1_000));
    const seen: unknown[] = [];
    lookup('attacker.example', { family: 0 }, (err, addr, family) => {
      seen.push(err, addr, family);
    });
    expect(seen).toEqual([null, '198.51.100.7', 4]);
  });

  it('answers the `{ all: true }` lookup signature with a pinned address array', () => {
    const lookup = httpsLookup(createPinnedHttpsAgent('2001:db8::1', 1_000));
    const seen: unknown[] = [];
    lookup('attacker.example', { all: true }, (err, addr, family) => {
      seen.push(err, addr, family);
    });
    expect(seen).toEqual([null, [{ address: '2001:db8::1', family: 6 }], undefined]);
  });
});

describe('pinned-agent structural tripwire', () => {
  // The DNS-rebinding defence must live in exactly one place. No caller may
  // construct its own connection agent, and every listed caller must build
  // one through this module.
  const callers: Array<{ file: string; factory: string }> = [
    { file: 'calendar/service/import/fetcher.ts', factory: 'createPinnedAgent' },
    { file: 'calendar/service/import/import_source_service.ts', factory: 'createPinnedAgent' },
    { file: 'activitypub/helper/remote-fetch.ts', factory: 'createPinnedHttpsAgent' },
    { file: 'activitypub/helper/http_signature.ts', factory: 'createPinnedHttpsAgent' },
  ];

  for (const { file, factory } of callers) {
    it(`${file} connects only through ${factory}`, () => {
      const source = readFileSync(path.join(SERVER_DIR, file), 'utf8');
      expect(source).toMatch(
        new RegExp(`import \\{[^}]*\\b${factory}\\b[^}]*\\} from '@/server/common/helper/pinned-agent';`),
      );
      expect(source).toMatch(new RegExp(`${factory}\\(`));
      expect(source).not.toMatch(/new Agent\(/);
      expect(source).not.toMatch(/new https?\.Agent\(/);
    });
  }

  it('the axios federation fetches pass the pinned agent as httpsAgent', () => {
    for (const file of ['activitypub/helper/remote-fetch.ts', 'activitypub/helper/http_signature.ts']) {
      const source = readFileSync(path.join(SERVER_DIR, file), 'utf8');
      const axiosGets = source.match(/axios\.get\(/g) ?? [];
      const pinnedAgents = source.match(/httpsAgent: createPinnedHttpsAgent\(/g) ?? [];
      expect(axiosGets.length, file).toBeGreaterThan(0);
      expect(pinnedAgents.length, file).toBe(axiosGets.length);
    }
  });
});
