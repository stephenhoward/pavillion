/**
 * Agent-definition discovery: read .agents/agents/*-<suffix>.md and report
 * each agent's name and description from YAML frontmatter.
 *
 * Pure filesystem reads — no subprocess, so no run() plumbing here.
 *
 * Operator-facing flow: .agents/skills/agent-discovery/SKILL.md
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AgentInfo {
  name: string;
  path: string;
  description: string;
}

/**
 * Read agent files matching a suffix from disk.
 * Reads YAML frontmatter for name and description.
 *
 * @param suffix - e.g. 'auditor', 'advisor', 'verifier'
 * @param agentsDir - defaults to '.agents/agents'
 */
export function discoverAgents(
  suffix: string,
  agentsDir = '.agents/agents',
): AgentInfo[] {
  let files: string[];
  try {
    files = readdirSync(agentsDir)
      .filter(f => f.endsWith(`-${suffix}.md`))
      .sort()
      .map(f => join(agentsDir, f));
  }
  catch {
    return [];
  }

  const agents: AgentInfo[] = [];

  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const name = extractFrontmatter(content, 'name');
      const description = extractFrontmatter(content, 'description');

      if (!name) continue;

      agents.push({ name, path: filePath, description: description ?? '' });
    }
    catch {
      // skip unreadable files
    }
  }

  return agents;
}

/**
 * Extract a scalar value from YAML frontmatter delimited by `---` lines.
 */
function extractFrontmatter(content: string, key: string): string | null {
  const lines = content.split('\n');
  let inFm = false;
  let sawOpen = false;

  for (const line of lines) {
    if (/^---\s*$/.test(line)) {
      if (!sawOpen) { sawOpen = true; inFm = true; continue; }
      else { break; }
    }
    if (!inFm) continue;

    const match = line.match(new RegExp(`^${key}\\s*:\\s*(.+)$`));
    if (match) {
      let value = match[1].trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      return value;
    }
  }

  return null;
}
