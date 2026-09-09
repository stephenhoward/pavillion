/**
 * Agent-facing CLI for enumerating agent definitions. JSON to stdout.
 *
 * Usage:
 *   npx tsx .agents/skills/agent-discovery/scripts/agents.ts <suffix>   # advisor | auditor | verifier
 *
 * Operator-facing flow: .agents/skills/agent-discovery/SKILL.md
 */

import { discoverAgents } from './lib/agents.js';

const USAGE = `usage: agents.ts <suffix>

  <suffix>   list .agents/agents/*-<suffix>.md with descriptions (JSON)
             conventional suffixes: advisor, auditor, verifier
`;

const [suffix] = process.argv.slice(2);

if (!suffix) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

console.log(JSON.stringify(discoverAgents(suffix), null, 2));
