import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { ImportRunEntity } from '@/server/calendar/entity/import_run';

describe('ImportRunEntity', () => {
  it('builds with the expected columns populated', () => {
    const id = uuidv4();
    const sourceId = uuidv4();
    const startedAt = new Date('2026-04-22T10:00:00Z');
    const finishedAt = new Date('2026-04-22T10:00:05Z');

    const entity = ImportRunEntity.build({
      id,
      import_source_id: sourceId,
      started_at: startedAt,
      finished_at: finishedAt,
      outcome: 'success',
      events_created: 3,
      events_updated: 2,
      events_skipped_locally_edited: 1,
      events_disappeared: 0,
      error_message: null,
    });

    expect(entity.id).toBe(id);
    expect(entity.import_source_id).toBe(sourceId);
    expect(entity.started_at).toEqual(startedAt);
    expect(entity.finished_at).toEqual(finishedAt);
    expect(entity.outcome).toBe('success');
    expect(entity.events_created).toBe(3);
    expect(entity.events_updated).toBe(2);
    expect(entity.events_skipped_locally_edited).toBe(1);
    expect(entity.events_disappeared).toBe(0);
    expect(entity.error_message).toBeNull();
  });

  it('captures a failure outcome with error_message', () => {
    const entity = ImportRunEntity.build({
      id: uuidv4(),
      import_source_id: uuidv4(),
      started_at: new Date('2026-04-22T10:00:00Z'),
      finished_at: new Date('2026-04-22T10:00:02Z'),
      outcome: 'fetch_error',
      error_message: 'timeout after 30s',
    });

    expect(entity.outcome).toBe('fetch_error');
    expect(entity.error_message).toBe('timeout after 30s');
  });

  it('defaults counts to 0 when not provided on build()', () => {
    const entity = ImportRunEntity.build({
      id: uuidv4(),
      import_source_id: uuidv4(),
      started_at: new Date('2026-04-22T10:00:00Z'),
      outcome: 'no_changes',
    });

    expect(entity.events_created).toBe(0);
    expect(entity.events_updated).toBe(0);
    expect(entity.events_skipped_locally_edited).toBe(0);
    expect(entity.events_disappeared).toBe(0);
  });

  it('accepts every allowed outcome value', () => {
    const outcomes = [
      'success',
      'no_changes',
      'fetch_error',
      'parse_error',
      'ssrf_blocked',
      'dns_error',
    ] as const;

    for (const outcome of outcomes) {
      const entity = ImportRunEntity.build({
        id: uuidv4(),
        import_source_id: uuidv4(),
        started_at: new Date(),
        outcome,
      });
      expect(entity.outcome).toBe(outcome);
    }
  });
});
