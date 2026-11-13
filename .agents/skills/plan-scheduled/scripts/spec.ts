/**
 * Agent-facing CLI for `/plan --scheduled`: the deterministic half of the
 * passes. JSON to stdout, except `state-write`, `revise-note` and
 * `last-block`, which print text ready to paste.
 *
 * Usage:
 *   npx tsx .agents/skills/plan-scheduled/scripts/spec.ts select <drafting|approved|revise>
 *   npx tsx .agents/skills/plan-scheduled/scripts/spec.ts inspect <root-id>
 *   npx tsx .agents/skills/plan-scheduled/scripts/spec.ts leaves <root-id>
 *   npx tsx .agents/skills/plan-scheduled/scripts/spec.ts last-block <root-id> <heading>
 *   npx tsx .agents/skills/plan-scheduled/scripts/spec.ts revise-note <root-id>
 *   npx tsx .agents/skills/plan-scheduled/scripts/spec.ts revision-number <root-id>
 *   npx tsx .agents/skills/plan-scheduled/scripts/spec.ts gate-misses <root-id>
 *   npx tsx .agents/skills/plan-scheduled/scripts/spec.ts state-write <spec:label>
 *
 * Operator-facing flow: .agents/skills/plan-scheduled/SKILL.md
 */

import {
  type Selection,
  type StateLabel,
  labelsOwnedBy,
  bdSelect,
  bdInspect,
  bdLeaves,
  bdNotes,
  lastBlock,
  reviseNote,
  revisionNumber,
  gateMisses,
  stateWriteArgs,
} from './lib/spec.js';

const USAGE = `usage: spec.ts <command> [args]

commands:
  select <drafting|approved|revise>   pass candidates, by priority then oldest (JSON rows)
  inspect <root-id>                   status, labels, field presence, routing headings (JSON)
  leaves <root-id>                    leaves under the root still to analyse (JSON rows)
  last-block <root-id> <heading>      body of the last block with that heading (text)
  revise-note <root-id>               the maintainer's revise note, empty if none (text)
  revision-number <root-id>           N for the next "(revision N)" blocks (JSON)
  gate-misses <root-id>               gate misses since the last restart (JSON)
  state-write <spec:label>            bd update flags for a state write (text)
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function json(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

const [command, ...args] = process.argv.slice(2);
const SELECTIONS: Selection[] = ['drafting', 'approved', 'revise'];

try {
  switch (command) {
    case 'select': {
      const [which] = args;
      if (!SELECTIONS.includes(which as Selection)) fail(USAGE);
      json(bdSelect(which as Selection));
      break;
    }
    case 'inspect': {
      const [id] = args;
      if (!id) fail(USAGE);
      json(bdInspect(id));
      break;
    }
    case 'leaves': {
      const [id] = args;
      if (!id) fail(USAGE);
      json(bdLeaves(id));
      break;
    }
    case 'last-block': {
      const [id, heading] = args;
      if (!id || !heading) fail(USAGE);
      const body = lastBlock(bdNotes(id), heading);
      if (body === null) process.exit(1);
      console.log(body);
      break;
    }
    case 'revise-note': {
      const [id] = args;
      if (!id) fail(USAGE);
      console.log(reviseNote(bdNotes(id)));
      break;
    }
    case 'revision-number': {
      const [id] = args;
      if (!id) fail(USAGE);
      json({ revision: revisionNumber(bdNotes(id)) });
      break;
    }
    case 'gate-misses': {
      const [id] = args;
      if (!id) fail(USAGE);
      json({ misses: gateMisses(bdNotes(id)) });
      break;
    }
    case 'state-write': {
      // Only this skill's own labels; build.ts writes spec:building/built/stalled.
      const [label] = args;
      if (!(labelsOwnedBy('plan-scheduled') as string[]).includes(label)) fail(USAGE);
      console.log(stateWriteArgs(label as StateLabel).join(' '));
      break;
    }
    default:
      fail(USAGE);
  }
}
catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
