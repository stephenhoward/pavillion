/**
 * Agent-facing CLI for bead escalation. JSON to stdout.
 *
 * Usage:
 *   npx tsx .agents/tools/bead.ts escalate <bead-id> <reason> [phase]
 *
 * The other bead subcommands moved to the skills that own them:
 *   state / sizing-check / enrichment-check
 *     -> npx tsx .agents/skills/bead-state-assessment/scripts/bead.ts
 *   agents <suffix>
 *     -> npx tsx .agents/skills/agent-discovery/scripts/agents.ts
 */

import { bdEscalate } from './lib/bead.js';

const USAGE = `usage: bead.ts escalate <bead-id> <reason> [phase]

  escalate <bead-id> <reason> [phase]  add needs-human label + idempotent Escalation note
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);

if (command !== 'escalate') fail(USAGE);

const [beadId, reason, phase] = args;
if (!beadId || !reason) fail(USAGE);

bdEscalate(beadId, reason, phase ?? 'unspecified');
console.log(JSON.stringify({ ok: true, beadId, label: 'needs-human' }));
