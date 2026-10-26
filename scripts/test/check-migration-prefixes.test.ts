import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detect, listMigrationFiles, main } from '../check-migration-prefixes';

describe('check-migration-prefixes: detect', () => {
  it('reports a duplicated prefix with both filenames', () => {
    const result = detect(['0046_foo.ts', '0046_bar.ts', '0047_baz.ts']);
    expect(result).toEqual([
      { prefix: '0046', files: ['0046_bar.ts', '0046_foo.ts'] },
    ]);
  });

  it('passes a tree where every prefix is distinct', () => {
    expect(detect(['0001_a.ts', '0002_b.ts', '0003_c.ts'])).toEqual([]);
  });

  it('ignores README.md and other files without a numeric prefix', () => {
    expect(detect(['README.md', '0001_a.ts', 'helpers.ts', '.gitkeep', '0001x_b.ts'])).toEqual([]);
  });

  it('reports three files sharing one prefix once, with all three names', () => {
    const result = detect(['0050_c.ts', '0050_a.ts', '0050_b.ts']);
    expect(result).toEqual([
      { prefix: '0050', files: ['0050_a.ts', '0050_b.ts', '0050_c.ts'] },
    ]);
  });

  it('reports each duplicated prefix separately, in prefix order', () => {
    const result = detect(['0009_x.ts', '0003_a.ts', '0003_b.ts', '0009_y.ts']);
    expect(result.map((d) => d.prefix)).toEqual(['0003', '0009']);
  });
});

describe('check-migration-prefixes: directory scan + CLI exit code', () => {
  let tmpDir: string;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-prefix-check-'));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const touch = (...names: string[]) => {
    for (const name of names) {
      fs.writeFileSync(path.join(tmpDir, name), '');
    }
  };

  it('listMigrationFiles returns only file names, not subdirectories', () => {
    touch('0001_a.ts');
    fs.mkdirSync(path.join(tmpDir, '0002_dir'));
    expect(listMigrationFiles(tmpDir)).toEqual(['0001_a.ts']);
  });

  it('main() returns non-zero and names every file sharing a prefix', () => {
    touch('0046_foo.ts', '0046_bar.ts', '0047_baz.ts', 'README.md');
    expect(main([tmpDir])).toBe(1);
    const output = stderr.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('0046_foo.ts');
    expect(output).toContain('0046_bar.ts');
    expect(output).not.toContain('0047_baz.ts');
  });

  it('main() returns zero for a clean tree', () => {
    touch('0001_a.ts', '0002_b.ts', 'README.md');
    expect(main([tmpDir])).toBe(0);
  });
});

/**
 * CI-wiring safety net: the real migrations/ directory must be duplicate-free
 * on whatever tree runs the tests.
 */
describe('check-migration-prefixes: live scan of migrations/', () => {
  it('reports no duplicated prefixes in the current tree', () => {
    const dir = path.resolve(process.cwd(), 'migrations');
    expect(detect(listMigrationFiles(dir))).toEqual([]);
  });
});
