/**
 * Agent-facing CLI for deterministic bead operations. JSON to stdout.
 *
 * Usage:
 *   npx tsx .claude/tools/bead.ts state <bead-id>
 *   npx tsx .claude/tools/bead.ts sizing-check <bead-id>
 *   npx tsx .claude/tools/bead.ts enrichment-check <bead-id>   # exit 0 enriched, 1 not
 *   npx tsx .claude/tools/bead.ts escalate <bead-id> <reason> [phase]
 *   npx tsx .claude/tools/bead.ts agents <suffix>              # advisor | auditor | verifier
 */

import {
  bdState,
  bdSizingCheck,
  bdEnrichmentCheck,
  bdEscalate,
  discoverAgents,
} from './lib/bead.js';

const USAGE = `usage: bead.ts <command> [args]

commands:
  state <bead-id>                    lifecycle state verdict (JSON)
  sizing-check <bead-id>             2-of-3 decomposition heuristic (JSON)
  enrichment-check <bead-id>         exit 0 if notes contain Implementation Context, else 1
  escalate <bead-id> <reason> [phase]  add needs-human label + idempotent Escalation note
  agents <suffix>                    list .claude/agents/*-<suffix>.md with descriptions (JSON)
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'state': {
    const [beadId] = args;
    if (!beadId) fail(USAGE);
    console.log(JSON.stringify(bdState(beadId), null, 2));
    break;
  }
  case 'sizing-check': {
    const [beadId] = args;
    if (!beadId) fail(USAGE);
    console.log(JSON.stringify(bdSizingCheck(beadId), null, 2));
    break;
  }
  case 'enrichment-check': {
    const [beadId] = args;
    if (!beadId) fail(USAGE);
    const enriched = bdEnrichmentCheck(beadId);
    console.log(JSON.stringify({ enriched }));
    process.exit(enriched ? 0 : 1);
    break;
  }
  case 'escalate': {
    const [beadId, reason, phase] = args;
    if (!beadId || !reason) fail(USAGE);
    bdEscalate(beadId, reason, phase ?? 'unspecified');
    console.log(JSON.stringify({ ok: true, beadId, label: 'needs-human' }));
    break;
  }
  case 'agents': {
    const [suffix] = args;
    if (!suffix) fail(USAGE);
    console.log(JSON.stringify(discoverAgents(suffix), null, 2));
    break;
  }
  default:
    fail(USAGE);
}
