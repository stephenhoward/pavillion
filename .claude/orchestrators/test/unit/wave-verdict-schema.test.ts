import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';

const schemaPath = resolve(import.meta.dirname, '../../schemas/wave-verdict.json');

function loadSchema(): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  // Remove $schema meta-reference — ajv v6 only supports draft-07,
  // but the schema itself uses only draft-07-compatible keywords.
  const { $schema: _, ...schema } = raw;
  return schema;
}

describe('wave-verdict.json schema', () => {
  let validate: ReturnType<Ajv['compile']>;

  it('should be valid JSON Schema', () => {
    const schema = loadSchema();
    const ajv = new Ajv();
    validate = ajv.compile(schema);
    expect(validate).toBeDefined();
  });

  it('should accept a passing wave-end verdict', () => {
    const ajv = new Ajv();
    validate = ajv.compile(loadSchema());

    const passingVerdict = {
      epicId: 'pv-1mt6',
      waveNumber: 1,
      verdict: 'pass',
      buildStatus: 'green',
      beadsCompleted: ['pv-1mt6.1', 'pv-1mt6.2'],
      beadsFailed: [],
      concerns: [],
      nextWaveReady: ['pv-1mt6.3', 'pv-1mt6.4'],
    };

    expect(validate(passingVerdict)).toBe(true);
  });

  it('should accept a failing wave-end verdict with concerns', () => {
    const ajv = new Ajv();
    validate = ajv.compile(loadSchema());

    const failingVerdict = {
      epicId: 'pv-1mt6',
      waveNumber: 2,
      verdict: 'fail',
      buildStatus: 'red',
      beadsCompleted: ['pv-1mt6.3'],
      beadsFailed: ['pv-1mt6.4'],
      concerns: [
        'Integration test calendar.test.ts fails after pv-1mt6.4 changes',
        'Type error in service layer introduced by pv-1mt6.4',
      ],
      nextWaveReady: [],
    };

    expect(validate(failingVerdict)).toBe(true);
  });

  it('should accept an escalate verdict', () => {
    const ajv = new Ajv();
    validate = ajv.compile(loadSchema());

    const escalateVerdict = {
      epicId: 'pv-1mt6',
      waveNumber: 3,
      verdict: 'escalate',
      buildStatus: 'red',
      beadsCompleted: [],
      beadsFailed: ['pv-1mt6.5'],
      concerns: ['Bead pv-1mt6.5 exceeded retry limit'],
      nextWaveReady: [],
    };

    expect(validate(escalateVerdict)).toBe(true);
  });

  it('should reject a verdict with missing required fields', () => {
    const ajv = new Ajv();
    validate = ajv.compile(loadSchema());

    const incomplete = {
      epicId: 'pv-1mt6',
      waveNumber: 1,
      // missing verdict, buildStatus, beadsCompleted, beadsFailed, concerns, nextWaveReady
    };

    expect(validate(incomplete)).toBe(false);
  });

  it('should reject an invalid verdict value', () => {
    const ajv = new Ajv();
    validate = ajv.compile(loadSchema());

    const badVerdict = {
      epicId: 'pv-1mt6',
      waveNumber: 1,
      verdict: 'maybe',
      buildStatus: 'green',
      beadsCompleted: [],
      beadsFailed: [],
      concerns: [],
      nextWaveReady: [],
    };

    expect(validate(badVerdict)).toBe(false);
  });

  it('should reject an invalid buildStatus value', () => {
    const ajv = new Ajv();
    validate = ajv.compile(loadSchema());

    const badStatus = {
      epicId: 'pv-1mt6',
      waveNumber: 1,
      verdict: 'pass',
      buildStatus: 'yellow',
      beadsCompleted: [],
      beadsFailed: [],
      concerns: [],
      nextWaveReady: [],
    };

    expect(validate(badStatus)).toBe(false);
  });

  it('should reject additional properties', () => {
    const ajv = new Ajv();
    validate = ajv.compile(loadSchema());

    const extraProps = {
      epicId: 'pv-1mt6',
      waveNumber: 1,
      verdict: 'pass',
      buildStatus: 'green',
      beadsCompleted: [],
      beadsFailed: [],
      concerns: [],
      nextWaveReady: [],
      extra: 'not-allowed',
    };

    expect(validate(extraProps)).toBe(false);
  });

  it('should reject waveNumber less than 1', () => {
    const ajv = new Ajv();
    validate = ajv.compile(loadSchema());

    const zeroWave = {
      epicId: 'pv-1mt6',
      waveNumber: 0,
      verdict: 'pass',
      buildStatus: 'green',
      beadsCompleted: [],
      beadsFailed: [],
      concerns: [],
      nextWaveReady: [],
    };

    expect(validate(zeroWave)).toBe(false);
  });
});
