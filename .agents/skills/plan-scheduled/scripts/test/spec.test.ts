/**
 * Unit tests for .agents/skills/plan-scheduled/scripts/lib/spec.ts
 *
 * Pure functions take parsed `bd ... --json` rows or a notes string. The
 * CLI-calling wrappers inject a fake spawnFn that returns canned JSON.
 */

import { describe, it, expect } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  type Bead,
  STATE_LABELS,
  STATE_LABEL_OWNERS,
  labelsOwnedBy,
  hasHeading,
  lastBlock,
  stateWriteArgs,
  selectDrafting,
  selectApproved,
  selectRevise,
  unanalysedLeaves,
  reviseNote,
  revisionNumber,
  gateMisses,
  inspect,
  bdSelect,
  bdInspect,
} from '../lib/spec.js';

// =============================================================================
// Helpers
// =============================================================================

function fakeSpawn(stdout: string, stderr = '', status = 0): SpawnSyncReturns<Buffer> {
  return {
    stdout: Buffer.from(stdout, 'utf-8'),
    stderr: Buffer.from(stderr, 'utf-8'),
    status,
    signal: null,
    pid: 1234,
    output: [null, Buffer.from(stdout), Buffer.from(stderr)],
  };
}

function bead(overrides: Partial<Bead> & { id: string }): Bead {
  return {
    title: `Title ${overrides.id}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-10-01T00:00:00Z',
    labels: [],
    parent: null,
    ...overrides,
  };
}

// =============================================================================
// Heading test and last block
// =============================================================================

describe('hasHeading', () => {
  it('matches any level and case, at start or after a newline', () => {
    expect(hasHeading('# Advisory Review\n- x', 'Advisory Review')).toBe(true);
    expect(hasHeading('intro\n###advisory review (revision 2)\n', 'Advisory Review')).toBe(true);
  });

  it('never matches prose or a substring', () => {
    expect(hasHeading('advisory review passed', 'Advisory Review')).toBe(false);
    expect(hasHeading('## Advisory Reviews', 'Advisory Review')).toBe(false);
    expect(hasHeading('## Implementation Context', 'Implementation Contex')).toBe(false);
  });

  it('treats undefined notes as empty', () => {
    expect(hasHeading(undefined, 'Planned hierarchy')).toBe(false);
  });
});

describe('lastBlock', () => {
  const notes = [
    '## Planned hierarchy',
    '',
    '| Title | Type |',
    '| a | task |',
    '',
    '## Decomposition notes',
    'shape',
    '## Planned hierarchy',
    '- none: single bead',
    '',
    '## Other',
    'tail',
  ].join('\n');

  it('returns the body of the last block with that heading, up to the next heading', () => {
    expect(lastBlock(notes, 'Planned hierarchy')).toBe('- none: single bead');
    expect(lastBlock(notes, 'Decomposition notes')).toBe('shape');
  });

  it('returns null when the heading is absent', () => {
    expect(lastBlock(notes, 'Bead Analysis')).toBeNull();
  });

  it('runs to the end of the notes when nothing follows', () => {
    expect(lastBlock(notes, 'Other')).toBe('tail');
  });
});

// =============================================================================
// State write
// =============================================================================

describe('stateWriteArgs', () => {
  it('removes every other state label and adds the target', () => {
    const args = stateWriteArgs('spec:drafted');
    expect(args).toEqual([
      '--remove-label', 'spec:blocked',
      '--remove-label', 'spec:revise',
      '--remove-label', 'spec:approved',
      '--remove-label', 'spec:decomposing',
      '--remove-label', 'spec:ready',
      '--remove-label', 'spec:building',
      '--remove-label', 'spec:built',
      '--remove-label', 'spec:stalled',
      '--add-label', 'spec:drafted',
    ]);
  });

  it('covers all nine labels', () => {
    expect(STATE_LABELS).toHaveLength(9);
    for (const label of STATE_LABELS) {
      const args = stateWriteArgs(label);
      expect(args.filter(a => a === '--remove-label')).toHaveLength(8);
      expect(args.slice(-2)).toEqual(['--add-label', label]);
    }
  });

  it('never removes a label outside the state table', () => {
    for (const label of STATE_LABELS) {
      const args = stateWriteArgs(label);
      expect(args).not.toContain('needs-human');
      expect(args).not.toContain('build:hold');
    }
  });

  it('gives every label one owner: the planner six, the builder three', () => {
    expect(Object.keys(STATE_LABEL_OWNERS).sort()).toEqual([...STATE_LABELS].sort());
    expect(labelsOwnedBy('plan-scheduled')).toEqual([
      'spec:drafted', 'spec:blocked', 'spec:revise',
      'spec:approved', 'spec:decomposing', 'spec:ready',
    ]);
    expect(labelsOwnedBy('build-scheduled')).toEqual([
      'spec:building', 'spec:built', 'spec:stalled',
    ]);
  });

  it('rejects an unknown label', () => {
    expect(() => stateWriteArgs('spec:nope' as never)).toThrow();
  });
});

// =============================================================================
// Selections
// =============================================================================

describe('selectDrafting', () => {
  const rows: Bead[] = [
    bead({ id: 'root-a', labels: ['office:engineering'], priority: 2, created_at: '2026-10-02T00:00:00Z' }),
    bead({ id: 'root-b', labels: ['office:product'], priority: 1 }),
    bead({ id: 'root-c', labels: ['office:product', 'spec:drafted'] }),
    bead({ id: 'root-d', labels: ['office:product'], notes: 'x\n## Advisory Review\n- ok' }),
    bead({ id: 'root-e', labels: ['office:product'], notes: 'advisory review passed' }),
    bead({ id: 'root-f', labels: ['office:product'], status: 'in_progress' }),
    bead({ id: 'root-g', labels: ['office:product', 'needs-human'], priority: 0 }),
    bead({ id: 'root-h', labels: ['office:operations'] }),
    bead({ id: 'root-h.1', parent: 'root-h', status: 'closed' }),
    bead({ id: 'root-i', labels: ['office:operations'] }),
    bead({ id: 'root-i.1', parent: 'root-i', status: 'open' }),
    bead({ id: 'root-j', labels: ['misc'] }),
    bead({ id: 'child-k', parent: 'root-a', labels: ['office:product'] }),
  ];

  it('selects open office roots with no spec label, no Advisory Review heading and no started children', () => {
    const ids = selectDrafting(rows).map(r => r.id);
    expect(ids).toEqual(['root-g', 'root-b', 'root-e', 'root-i', 'root-a']);
  });

  it('orders by priority then oldest first and flags needs-human', () => {
    const out = selectDrafting(rows);
    expect(out[0]).toMatchObject({ id: 'root-g', needs_human: true, priority: 0 });
    expect(out.find(r => r.id === 'root-b')?.needs_human).toBe(false);
    expect(out.map(r => r.id).indexOf('root-e')).toBeLessThan(out.map(r => r.id).indexOf('root-a'));
  });
});

describe('selectApproved', () => {
  const rows: Bead[] = [
    bead({ id: 'a', labels: ['spec:approved'], priority: 2 }),
    bead({ id: 'b', labels: ['spec:decomposing', 'needs-human'], priority: 1 }),
    bead({ id: 'c', labels: ['spec:approved', 'spec:revise'], priority: 1, created_at: '2026-09-01T00:00:00Z' }),
    bead({ id: 'd', labels: ['spec:ready'] }),
    bead({ id: 'e', labels: ['spec:approved'], status: 'closed' }),
    bead({ id: 'f', labels: ['spec:approved'], parent: 'a' }),
  ];

  it('takes open approved or decomposing roots, with their spec and needs-human labels', () => {
    const out = selectApproved(rows);
    expect(out.map(r => r.id)).toEqual(['c', 'b', 'a']);
    expect(out[0].labels).toEqual(['spec:approved', 'spec:revise']);
    expect(out[1]).toMatchObject({ needs_human: true, labels: ['spec:decomposing', 'needs-human'] });
    expect(out[1].also_revise).toBe(false);
    expect(out[0].also_revise).toBe(true);
  });
});

describe('selectRevise', () => {
  it('takes open spec:revise roots only', () => {
    const rows: Bead[] = [
      bead({ id: 'a', labels: ['spec:revise'] }),
      bead({ id: 'b', labels: ['spec:revise'], parent: 'a' }),
      bead({ id: 'c', labels: ['spec:drafted'] }),
      bead({ id: 'd', labels: ['spec:revise', 'needs-human'], priority: 0 }),
    ];
    const out = selectRevise(rows);
    expect(out.map(r => r.id)).toEqual(['d', 'a']);
    expect(out[0].needs_human).toBe(true);
  });
});

// =============================================================================
// Leaves
// =============================================================================

describe('unanalysedLeaves', () => {
  const rows: Bead[] = [
    bead({ id: 'root' }),
    bead({ id: 'root.1', parent: 'root' }),
    bead({ id: 'root.2', parent: 'root', notes: '## Implementation Context\n- files' }),
    bead({ id: 'root.3', parent: 'root', status: 'closed' }),
    bead({ id: 'root.4', parent: 'root', issue_type: 'decision', title: 'Decide: x' }),
    bead({ id: 'root.5', parent: 'root' }),
    bead({ id: 'root.5.1', parent: 'root.5' }),
    bead({ id: 'root.5.2', parent: 'root.5', notes: 'see implementation context later' }),
    bead({ id: 'other' }),
    bead({ id: 'other.1', parent: 'other' }),
  ];

  it('lists open non-decision leaves under the root at any depth without an Implementation Context heading', () => {
    expect(unanalysedLeaves(rows, 'root')).toEqual([
      { id: 'root.1', title: 'Title root.1' },
      { id: 'root.5.1', title: 'Title root.5.1' },
      { id: 'root.5.2', title: 'Title root.5.2' },
    ]);
  });

  it('returns nothing for a root with no children', () => {
    expect(unanalysedLeaves(rows, 'other.1')).toEqual([]);
  });
});

// =============================================================================
// Revise note, revision number, gate misses
// =============================================================================

describe('reviseNote', () => {
  it('returns empty when there is no Decisions block', () => {
    expect(reviseNote('## Advisory Review\n- ok')).toBe('');
    expect(reviseNote(undefined)).toBe('');
  });

  it('reads plain text appended after the last block items, skipping wrapped item lines', () => {
    const notes = [
      '## Decisions made for you',
      '- **Q:** a? — **A:** b — because',
      '  wrapped continuation',
      '',
      'Please tighten the scope to the widget only.',
      'Second line of the note.',
      '',
    ].join('\n');
    expect(reviseNote(notes)).toBe('Please tighten the scope to the widget only.\nSecond line of the note.');
  });

  it('skips a bare none block', () => {
    expect(reviseNote('## Decisions made for you\nnone\n\nDo it differently.')).toBe('Do it differently.');
    expect(reviseNote('## Decisions made for you\n- none')).toBe('');
  });

  it('cuts at the next heading, so a following Design ruling is not the note', () => {
    const notes = [
      '## Decisions made for you (revision 1)',
      '- **Q:** a? — **A:** refused — reason',
      'Note text.',
      '## Design ruling — slug (2026-11-01)',
      'ruling body',
    ].join('\n');
    expect(reviseNote(notes)).toBe('Note text.');
  });

  it('prefers a dated revision heading written after the last Decisions block', () => {
    const notes = [
      '## Decisions made for you (revision 1)',
      '- **Q:** a? — **A:** b — c',
      'stale plain note',
      "## Maintainer's revision (2026-11-02)",
      '',
      'Drop the admin page.',
      '',
      '## Design ruling — x (2026-11-02)',
      'settled',
    ].join('\n');
    expect(reviseNote(notes)).toBe('Drop the admin page.');
  });

  it('reads only after the last Decisions block', () => {
    const notes = [
      '## Decisions made for you',
      'old note',
      '## Advisory Review (revision 1)',
      '- a: APPROVE',
      '## Decisions made for you (revision 1)',
      'none',
    ].join('\n');
    expect(reviseNote(notes)).toBe('');
  });
});

describe('revisionNumber', () => {
  it('is 1 with no revision headings', () => {
    expect(revisionNumber('## Decisions made for you\nnone')).toBe(1);
  });

  it('counts only Decisions revision headings', () => {
    const notes = [
      '## Advisory Review (revision 1)',
      '## Decisions made for you (revision 1)',
      '### decisions made for you (Revision 2)',
      "## Maintainer's revision (2026-11-02)",
    ].join('\n');
    expect(revisionNumber(notes)).toBe(3);
  });
});

describe('gateMisses', () => {
  it('counts miss lines since the last decomposition-gate restart', () => {
    const notes = [
      '## Decomposition gate',
      '- gate not met 2026-10-01: a',
      '- gate not met 2026-10-02: b',
      '- gate not met 2026-10-03: c',
      '## Decisions made for you (decomposition gate)',
      '- **Q:** Finish? — **A:** stopped — c',
      '## Decomposition gate',
      '- gate not met 2026-10-10: d',
    ].join('\n');
    expect(gateMisses(notes)).toBe(1);
  });

  it('counts every miss when there was no restart', () => {
    expect(gateMisses('- gate not met 2026-10-01: a\n- gate not met 2026-10-02: b')).toBe(2);
    expect(gateMisses(undefined)).toBe(0);
  });
});

// =============================================================================
// inspect
// =============================================================================

describe('inspect', () => {
  it('summarises status, labels and the headings the passes route on', () => {
    const out = inspect(bead({
      id: 'r',
      labels: ['office:product', 'spec:decomposing', 'needs-human'],
      notes: '## Planned hierarchy\n| t |\n## Implementation Context\nx',
      description: 'd',
      design: '',
    }));
    expect(out).toEqual({
      id: 'r',
      status: 'open',
      labels: ['office:product', 'spec:decomposing', 'needs-human'],
      state_labels: ['spec:decomposing'],
      needs_human: true,
      fields: { description: true, design: false, acceptance: false },
      last_heading: '## Implementation Context',
      headings: {
        planned_hierarchy: true,
        implementation_context: true,
        bead_analysis: false,
        advisory_review: false,
        decisions: false,
      },
    });
  });
});

describe('inspect last_heading', () => {
  it('is null without headings and ignores prose', () => {
    expect(inspect(bead({ id: 'r', notes: 'no headings here\n- item' })).last_heading).toBeNull();
    expect(inspect(bead({ id: 'r' })).last_heading).toBeNull();
    expect(inspect(bead({ id: 'r', notes: '## A\nx\n## Decomposition gate\n- gate not met 2026-10-01: a' })).last_heading)
      .toBe('## Decomposition gate');
  });
});

// =============================================================================
// CLI wrappers
// =============================================================================

describe('bdSelect', () => {
  it('runs bd list --all --limit 0 --json and applies the named selection', () => {
    const calls: string[][] = [];
    const spawn = (_cmd: string, args: string[]) => {
      calls.push(args);
      return fakeSpawn(JSON.stringify([
        bead({ id: 'a', labels: ['spec:revise'] }),
        bead({ id: 'b', labels: ['office:product'] }),
      ]));
    };
    const out = bdSelect('revise', { spawnFn: spawn as never });
    expect(out.map(r => r.id)).toEqual(['a']);
    expect(calls[0]).toEqual(['list', '--all', '--limit', '0', '--json']);
  });

  it('throws when bd fails', () => {
    const spawn = () => fakeSpawn('', 'boom', 1);
    expect(() => bdSelect('drafting', { spawnFn: spawn as never })).toThrow(/bd list/);
  });
});

describe('bdInspect', () => {
  it('reads bd show <id> --json', () => {
    const spawn = (_cmd: string, args: string[]) => {
      expect(args).toEqual(['show', 'r', '--json']);
      return fakeSpawn(JSON.stringify([bead({ id: 'r', labels: ['spec:revise'] })]));
    };
    expect(bdInspect('r', { spawnFn: spawn as never }).state_labels).toEqual(['spec:revise']);
  });
});
