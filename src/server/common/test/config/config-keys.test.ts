import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

/**
 * Every literal key the server reads with config.get() must resolve in the
 * configuration a production instance boots with: default.yaml overlaid by
 * production.yaml.
 *
 * config.get() throws on a missing key, and many reads run at module load
 * (the rate limiters among them), so a key lost to a YAML nesting slip
 * crash-loops the server at startup. test.yaml redefines much of the tree,
 * which is why the rest of the suite cannot see such a slip.
 *
 * A key the same file guards with config.has() is optional by design and
 * is exempt.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../../../../..');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');
const SERVER_DIR = path.join(PROJECT_ROOT, 'src/server');

const GET_PATTERN = /config\.get(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g;
const HAS_PATTERN = /config\.has\(\s*['"]([^'"]+)['"]/g;

type ConfigTree = Record<string, unknown>;

function isTree(value: unknown): value is ConfigTree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: ConfigTree, override: ConfigTree): ConfigTree {
  const merged: ConfigTree = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = isTree(value) && isTree(merged[key])
      ? deepMerge(merged[key] as ConfigTree, value)
      : value;
  }
  return merged;
}

function resolve(tree: ConfigTree, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, segment) => (isTree(node) ? node[segment] : undefined),
    tree,
  );
}

function serverSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'test' ? [] : serverSourceFiles(fullPath);
    }
    return entry.name.endsWith('.ts') ? [fullPath] : [];
  });
}

function loadYaml(fileName: string): ConfigTree {
  return yaml.parse(fs.readFileSync(path.join(CONFIG_DIR, fileName), 'utf8')) ?? {};
}

describe('Configuration keys read by the server', () => {
  const productionConfig = deepMerge(loadYaml('default.yaml'), loadYaml('production.yaml'));

  const requiredReads: { key: string; file: string }[] = [];
  for (const file of serverSourceFiles(SERVER_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    const guarded = new Set([...source.matchAll(HAS_PATTERN)].map((match) => match[1]));
    for (const match of source.matchAll(GET_PATTERN)) {
      if (!guarded.has(match[1])) {
        requiredReads.push({ key: match[1], file: path.relative(PROJECT_ROOT, file) });
      }
    }
  }

  it('should find config.get() reads to check', () => {
    expect(requiredReads.length).toBeGreaterThan(0);
  });

  it('should resolve every unguarded config.get() key in default.yaml + production.yaml', () => {
    const missing = requiredReads
      .filter(({ key }) => resolve(productionConfig, key) === undefined)
      .map(({ key, file }) => `${key} (${file})`);

    expect(missing).toEqual([]);
  });
});
