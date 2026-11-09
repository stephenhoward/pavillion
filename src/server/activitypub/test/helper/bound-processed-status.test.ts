import { describe, it, expect } from 'vitest';
import { boundProcessedStatus, PROCESSED_STATUS_MAX_LENGTH } from '@/server/activitypub/helper/outbox';

describe('boundProcessedStatus', () => {
  it('matches the processed_status column width', () => {
    expect(PROCESSED_STATUS_MAX_LENGTH).toBe(255);
  });

  it('leaves a status under the limit unchanged', () => {
    expect(boundProcessedStatus('partial: Failed to deliver to https://peer.example/a: boom'))
      .toBe('partial: Failed to deliver to https://peer.example/a: boom');
  });

  it('leaves a status of exactly the limit unchanged', () => {
    const status = 'partial: ' + 'x'.repeat(255 - 'partial: '.length);
    expect(status).toHaveLength(255);
    expect(boundProcessedStatus(status)).toBe(status);
  });

  it('cuts a status one over the limit to the limit', () => {
    const status = 'p'.repeat(256);
    expect(boundProcessedStatus(status)).toBe('p'.repeat(255));
  });

  it('cuts a very long status to the limit and keeps its prefix', () => {
    const status = 'partial: ' + 'y'.repeat(10_000);
    const bounded = boundProcessedStatus(status);
    expect(bounded).toHaveLength(255);
    expect(bounded).toBe(status.slice(0, 255));
    expect(bounded.startsWith('partial: ')).toBe(true);
  });

  it('replaces NUL, CR, LF and other C0 control characters with spaces', () => {
    const bounded = boundProcessedStatus('partial: a\u0000b\r\nc\td\u001fe\u0007f');
    expect(bounded).toBe('partial: a b  c d e f');
    // eslint-disable-next-line no-control-regex
    expect(bounded).not.toMatch(/[\u0000-\u001f]/);
  });

  it('replaces control characters before cutting, so the result never exceeds the limit', () => {
    const status = 'partial: ' + '\u0000'.repeat(300);
    const bounded = boundProcessedStatus(status);
    expect(bounded).toHaveLength(255);
    expect(bounded).toBe('partial: ' + ' '.repeat(246));
  });
});
