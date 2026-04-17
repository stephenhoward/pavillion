// .claude/orchestrators/test/unit/types.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { PhaseName, MAX_IMPLEMENTER_SLOTS, MAX_WAVE_RETRIES, MAX_LEAF_RETRIES, createRunLogger } from '../../lib/types.js';
import { existsSync, readFileSync, rmSync } from 'node:fs';

describe('types', () => {
  describe('PhaseName enum', () => {
    it('has all expected phase names', () => {
      expect(PhaseName.Preflight).toBe('phase-0-preflight');
      expect(PhaseName.Select).toBe('phase-1-select');
      expect(PhaseName.State).toBe('phase-2-state');
      expect(PhaseName.Shape).toBe('phase-3-shape');
      expect(PhaseName.ShapeAdvisors).toBe('phase-3.5-advisors');
      expect(PhaseName.Decompose).toBe('phase-4-decompose');
      expect(PhaseName.Analyze).toBe('phase-5-analyze');
      expect(PhaseName.AnalyzeAdvisors).toBe('phase-5.5-advisors');
      expect(PhaseName.Branch).toBe('phase-6-branch');
      expect(PhaseName.Epic).toBe('phase-7a-epic');
      expect(PhaseName.Leaf).toBe('phase-7b-leaf');
      expect(PhaseName.PR).toBe('phase-8-pr');
      expect(PhaseName.Report).toBe('phase-9-report');
      expect(PhaseName.Halt).toBe('halt');
    });
  });

  describe('wave constants', () => {
    it('MAX_IMPLEMENTER_SLOTS is 3', () => {
      expect(MAX_IMPLEMENTER_SLOTS).toBe(3);
    });
    it('MAX_WAVE_RETRIES is 2', () => {
      expect(MAX_WAVE_RETRIES).toBe(2);
    });
    it('MAX_LEAF_RETRIES is 1', () => {
      expect(MAX_LEAF_RETRIES).toBe(1);
    });
  });

  describe('createRunLogger', () => {
    const testRunId = 'test-logger-run';

    afterEach(() => {
      const logger = createRunLogger(testRunId);
      const dir = logger.runDir();
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('creates log directory lazily on first write', () => {
      const logger = createRunLogger(testRunId);
      logger.writePhaseLog(PhaseName.Preflight, 'out', 'hello\n');
      const dir = logger.runDir();
      expect(existsSync(dir)).toBe(true);
    });

    it('appends structured JSON to run.jsonl', () => {
      const logger = createRunLogger(testRunId);
      logger.appendRunJson({ event: 'test', value: 42 });
      const dir = logger.runDir();
      const content = readFileSync(`${dir}/run.jsonl`, 'utf-8');
      expect(JSON.parse(content.trim())).toEqual({ event: 'test', value: 42 });
    });
  });
});
