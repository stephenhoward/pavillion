/**
 * Deterministic bead lifecycle and sizing classifiers.
 *
 * Exports:
 *   CLI helpers: bdState, bdSizingCheck, bdEnrichmentCheck
 *   Pure helpers: classifyBeadState, classifySizing
 *
 * Operator-facing flow: .agents/skills/bead-state-assessment/SKILL.md
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { run, type SpawnDeps } from './run.js';

export interface StateVerdict {
  state: 'unshaped' | 'shaped' | 'advised' | 'decomposed' | 'analyzed' | 'executing' | 'complete';
  missing_phases: string[];
  reasons: string[];
}

export interface SizingVerdict {
  needs_decomposition: boolean;
  reasons: string[];
}

// =============================================================================
// classifyBeadState (pure)
// =============================================================================

/**
 * Pure function: classify bead state from `bd show` text content.
 */
export function classifyBeadState(content: string): StateVerdict {
  const lines = content.split('\n');

  // Detect status from first line header
  const header = lines[0] ?? '';
  let status: 'closed' | 'in_progress' | 'open' | 'unknown' = 'unknown';
  if (/CLOSED/.test(header)) status = 'closed';
  else if (/IN_PROGRESS/.test(header)) status = 'in_progress';
  else if (/OPEN/.test(header)) status = 'open';

  // Helper: check if a section header exists (all-caps on its own line)
  const hasSection = (name: string): boolean =>
    lines.some(l => l.trim() === name);

  // Description is non-empty if there's a non-blank line after DESCRIPTION
  // before the next all-caps header
  const descriptionNonEmpty = (): boolean => {
    let inBlock = false;
    for (const line of lines) {
      if (line.trim() === 'DESCRIPTION') {
        inBlock = true;
        continue;
      }
      if (inBlock) {
        if (/^[A-Z][A-Z ]+$/.test(line.trim()) && line.trim().length > 1) break;
        if (line.trim().length > 0) return true;
      }
    }
    return false;
  };

  // Children section has at least one ↳ line
  const hasChildBead = (): boolean =>
    lines.some(l => /^\s+↳ /.test(l));

  // Notes contain "Implementation Context"
  const hasImplContext = (): boolean =>
    content.includes('Implementation Context');

  // Notes contain "Advisory Review" — written by /plan's ADVISE phase
  const hasAdvisoryReview = (): boolean =>
    content.includes('Advisory Review');

  const reasons: string[] = [];

  const hasDesc = hasSection('DESCRIPTION') && descriptionNonEmpty();
  const hasDesign = hasSection('DESIGN');
  const hasAccept = hasSection('ACCEPTANCE CRITERIA');
  const hasChildren = hasSection('CHILDREN') && hasChildBead();
  const hasImplCtx = hasImplContext();
  const hasAdvised = hasAdvisoryReview();

  if (hasDesc) reasons.push('has non-empty DESCRIPTION');
  else reasons.push('missing or empty DESCRIPTION');

  if (hasDesign) reasons.push('has DESIGN section');
  else reasons.push('missing DESIGN section');

  if (hasAccept) reasons.push('has ACCEPTANCE CRITERIA section');
  else reasons.push('missing ACCEPTANCE CRITERIA section');

  if (hasAdvised) reasons.push('notes contain Advisory Review');
  if (hasChildren) reasons.push('has CHILDREN with at least one child bead');
  if (hasImplCtx) reasons.push('notes contain Implementation Context');

  // Build missing_phases
  const missing: string[] = [];
  if (!hasDesc || !hasDesign || !hasAccept) missing.push('shaped');
  if (!hasAdvised) missing.push('advised');
  if (!hasChildren) missing.push('decomposed');
  if (!hasImplCtx) missing.push('analyzed');

  // Determine state — status overrides section-based detection.
  // Otherwise, state is the highest milestone reached.
  let state: StateVerdict['state'] = 'unshaped';

  if (status === 'closed') {
    state = 'complete';
    reasons.push('bead status is CLOSED');
  }
  else if (status === 'in_progress') {
    state = 'executing';
    reasons.push('bead status is IN_PROGRESS');
  }
  else if (hasImplCtx) {
    state = 'analyzed';
  }
  else if (hasChildren) {
    state = 'decomposed';
  }
  else if (hasAdvised && hasDesc && hasDesign && hasAccept) {
    state = 'advised';
  }
  else if (hasDesc && hasDesign && hasAccept) {
    state = 'shaped';
  }

  return { state, missing_phases: missing, reasons };
}

// =============================================================================
// bdState
// =============================================================================

/**
 * Classify bead lifecycle state via `bd show <beadId>`.
 */
export function bdState(beadId: string, deps: SpawnDeps = {}): StateVerdict {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const result = run('bd', ['show', beadId], spawn);

  if (result.exitCode !== 0) {
    // Return unshaped with empty fields as a safe default
    return {
      state: 'unshaped',
      missing_phases: ['shaped', 'advised', 'decomposed', 'analyzed'],
      reasons: [`bd show ${beadId} failed with exit code ${result.exitCode}`],
    };
  }

  return classifyBeadState(result.stdout);
}

// =============================================================================
// classifySizing (pure)
// =============================================================================

/**
 * Pure function: 2-of-3 decomposition heuristic over scope text.
 *
 * Criteria:
 *   (a) 4+ distinct file paths
 *   (b) 2+ domain areas
 *   (c) 4+ bullet items
 */
export function classifySizing(scopeText: string): SizingVerdict {
  const reasons: string[] = [];
  let passes = 0;

  // (a) File count — look for extension-bearing tokens
  const fileMatches = scopeText.match(
    /[A-Za-z0-9_./-]+\.(ts|tsx|js|vue|scss|css|sql|md|json|yaml|yml|sh|html)/g,
  ) ?? [];
  const uniqueFiles = new Set(fileMatches);
  const fileCount = uniqueFiles.size;

  if (fileCount >= 4) {
    reasons.push(`implies ${fileCount} or more files`);
    passes++;
  }

  // (b) Multi-domain span
  const lc = scopeText.toLowerCase();
  const backendHits = (lc.match(/\b(backend|api|service|entity|migration|sequelize|endpoint|route)\b/g) ?? []).length;
  const frontendHits = (lc.match(/\b(frontend|vue|component|pinia|store|site|client|scss|css)\b/g) ?? []).length;
  const translationHits = (lc.match(/\b(locale|translation|i18n|i18next)\b/g) ?? []).length;
  const federationHits = (lc.match(/\b(activitypub|federation|federated|inbox|outbox|actor)\b/g) ?? []).length;

  let domainsSpanned = 0;
  if (backendHits > 0) domainsSpanned++;
  if (frontendHits > 0) domainsSpanned++;
  if (translationHits > 0) domainsSpanned++;
  if (federationHits > 0) domainsSpanned++;

  if (domainsSpanned >= 2) {
    reasons.push(
      `spans multiple domains (backend=${backendHits}, frontend=${frontendHits}, translation=${translationHits}, federation=${federationHits})`,
    );
    passes++;
  }

  // (c) Bullet items
  const bulletMatches = scopeText.match(/^[ \t]*([-*]|[0-9]+\.)[ \t]+/gm) ?? [];
  const bulletCount = bulletMatches.length;

  if (bulletCount >= 4) {
    reasons.push(`${bulletCount} independent deliverables listed`);
    passes++;
  }

  const needsDecomposition = passes >= 2;

  if (!needsDecomposition && reasons.length === 0) {
    reasons.push('fewer than 4 files, single domain, few deliverables — fits leaf size');
  }

  return { needs_decomposition: needsDecomposition, reasons };
}

// =============================================================================
// bdSizingCheck
// =============================================================================

/**
 * Run sizing check against a bead's DESCRIPTION + DESIGN sections.
 */
export function bdSizingCheck(beadId: string, deps: SpawnDeps = {}): SizingVerdict {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const result = run('bd', ['show', beadId], spawn);

  if (result.exitCode !== 0) {
    return { needs_decomposition: false, reasons: [`bd show ${beadId} failed`] };
  }

  // Extract DESCRIPTION and DESIGN section bodies
  const extractSection = (content: string, name: string): string => {
    const lines = content.split('\n');
    let inBlock = false;
    const collected: string[] = [];
    for (const line of lines) {
      if (line.trim() === name) { inBlock = true; continue; }
      if (inBlock) {
        if (/^[A-Z][A-Z ]+$/.test(line.trim()) && line.trim().length > 1) break;
        collected.push(line);
      }
    }
    return collected.join('\n');
  };

  const scopeText = [
    extractSection(result.stdout, 'DESCRIPTION'),
    extractSection(result.stdout, 'DESIGN'),
  ].join('\n');

  return classifySizing(scopeText);
}

// =============================================================================
// bdEnrichmentCheck
// =============================================================================

/**
 * Check if a bead's notes contain "Implementation Context".
 * Returns true if enriched.
 */
export function bdEnrichmentCheck(beadId: string, deps: SpawnDeps = {}): boolean {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const result = run('bd', ['show', beadId], spawn);

  if (result.exitCode !== 0) return false;

  return result.stdout.includes('Implementation Context');
}

