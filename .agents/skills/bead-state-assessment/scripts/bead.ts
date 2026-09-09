/**
 * Agent-facing CLI for deterministic bead state checks. JSON to stdout.
 *
 * Usage:
 *   npx tsx .agents/skills/bead-state-assessment/scripts/bead.ts state <bead-id>
 *   npx tsx .agents/skills/bead-state-assessment/scripts/bead.ts sizing-check <bead-id>
 *   npx tsx .agents/skills/bead-state-assessment/scripts/bead.ts enrichment-check <bead-id>   # exit 0 enriched, 1 not
 *
 * Operator-facing flow: .agents/skills/bead-state-assessment/SKILL.md
 */

import {
  bdState,
  bdSizingCheck,
  bdEnrichmentCheck,
} from './lib/bead.js';

const USAGE = `usage: bead.ts <command> [args]

commands:
  state <bead-id>              lifecycle state verdict (JSON)
  sizing-check <bead-id>       2-of-3 decomposition heuristic (JSON)
  enrichment-check <bead-id>   exit 0 if notes contain Implementation Context, else 1
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
  default:
    fail(USAGE);
}
