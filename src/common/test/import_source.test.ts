import { describe, it, expect } from 'vitest';

import {
  ImportSource,
  IMPORT_SOURCE_VERIFICATION_STATES,
  IMPORT_SOURCE_VERIFICATION_TYPES,
  IMPORT_SOURCE_LAST_STATUSES,
} from '@/common/model/import_source';

describe('ImportSource', () => {
  describe('constructor', () => {
    it('initializes with safe defaults when no args are provided', () => {
      const model = new ImportSource();

      expect(model.id).toBe('');
      expect(model.calendarId).toBe('');
      expect(model.url).toBe('');
      expect(model.enabled).toBe(true);
      expect(model.verificationType).toBe('dns-txt');
      expect(model.verificationState).toBe('unverified');
      expect(model.verifiedAt).toBeNull();
      expect(model.verificationExpiresAt).toBeNull();
      expect(model.etag).toBeNull();
      expect(model.contentHash).toBeNull();
      expect(model.lastFetchedAt).toBeNull();
      expect(model.lastStatus).toBeNull();
      expect(model.createdAt).toBeNull();
      expect(model.updatedAt).toBeNull();
    });

    it('accepts id, calendarId, and url', () => {
      const model = new ImportSource('src-1', 'cal-1', 'https://example.com/cal.ics');

      expect(model.id).toBe('src-1');
      expect(model.calendarId).toBe('cal-1');
      expect(model.url).toBe('https://example.com/cal.ics');
    });
  });

  describe('enumerations', () => {
    it('exposes verification states', () => {
      expect(IMPORT_SOURCE_VERIFICATION_STATES).toEqual([
        'unverified',
        'pending',
        'verified',
        'expired',
      ]);
    });

    it('exposes verification types (discriminator)', () => {
      // Only `dns-txt` is defined today. Future verifier beads extend the
      // union in the same change that introduces the verifier. See bead
      // pv-44qj.
      expect(IMPORT_SOURCE_VERIFICATION_TYPES).toEqual(['dns-txt']);
    });

    it('exposes last-status values', () => {
      expect(IMPORT_SOURCE_LAST_STATUSES).toEqual([
        'ok',
        'fetch_error',
        'parse_error',
        'ssrf_blocked',
        'dns_error',
        'rate_limited',
      ]);
    });
  });

  describe('toObject()', () => {
    it('serializes all fields with ISO-string date formatting', () => {
      const model = new ImportSource('src-1', 'cal-1', 'https://example.com/cal.ics');
      model.enabled = false;
      model.verificationState = 'verified';
      model.verifiedAt = new Date('2026-04-22T10:00:00.000Z');
      model.verificationExpiresAt = new Date('2026-10-22T10:00:00.000Z');
      model.etag = 'W/"abc123"';
      model.contentHash = 'deadbeef';
      model.lastFetchedAt = new Date('2026-04-22T12:00:00.000Z');
      model.lastStatus = 'ok';
      model.createdAt = new Date('2026-04-22T09:00:00.000Z');
      model.updatedAt = new Date('2026-04-22T12:00:00.000Z');

      const obj = model.toObject();

      expect(obj).toEqual({
        id: 'src-1',
        calendarId: 'cal-1',
        url: 'https://example.com/cal.ics',
        enabled: false,
        verificationType: 'dns-txt',
        verificationState: 'verified',
        verifiedAt: '2026-04-22T10:00:00.000Z',
        verificationExpiresAt: '2026-10-22T10:00:00.000Z',
        etag: 'W/"abc123"',
        contentHash: 'deadbeef',
        lastFetchedAt: '2026-04-22T12:00:00.000Z',
        lastStatus: 'ok',
        createdAt: '2026-04-22T09:00:00.000Z',
        updatedAt: '2026-04-22T12:00:00.000Z',
      });
    });

    it('emits null for unset date fields', () => {
      const model = new ImportSource('src-1', 'cal-1', 'https://example.com/cal.ics');

      const obj = model.toObject();

      expect(obj.verifiedAt).toBeNull();
      expect(obj.verificationExpiresAt).toBeNull();
      expect(obj.lastFetchedAt).toBeNull();
      expect(obj.createdAt).toBeNull();
      expect(obj.updatedAt).toBeNull();
    });

    it('never serializes a verification_token field (owner-only secret)', () => {
      const model = new ImportSource('src-1', 'cal-1', 'https://example.com/cal.ics');
      // Intentionally assign to prove the model has no persistence path for it.
      (model as any).verificationToken = 'should-not-leak';

      const obj = model.toObject();

      expect(obj).not.toHaveProperty('verificationToken');
      expect(obj).not.toHaveProperty('verification_token');
    });
  });

  describe('fromObject()', () => {
    it('deserializes a complete payload', () => {
      const obj = {
        id: 'src-1',
        calendarId: 'cal-1',
        url: 'https://example.com/cal.ics',
        enabled: false,
        verificationType: 'dns-txt',
        verificationState: 'pending',
        verifiedAt: '2026-04-22T10:00:00.000Z',
        verificationExpiresAt: null,
        etag: 'W/"abc"',
        contentHash: 'cafef00d',
        lastFetchedAt: '2026-04-22T12:00:00.000Z',
        lastStatus: 'fetch_error',
        createdAt: '2026-04-22T09:00:00.000Z',
        updatedAt: '2026-04-22T12:00:00.000Z',
      };

      const model = ImportSource.fromObject(obj);

      expect(model.id).toBe('src-1');
      expect(model.calendarId).toBe('cal-1');
      expect(model.url).toBe('https://example.com/cal.ics');
      expect(model.enabled).toBe(false);
      expect(model.verificationType).toBe('dns-txt');
      expect(model.verificationState).toBe('pending');
      expect(model.verifiedAt).toEqual(new Date('2026-04-22T10:00:00.000Z'));
      expect(model.verificationExpiresAt).toBeNull();
      expect(model.etag).toBe('W/"abc"');
      expect(model.contentHash).toBe('cafef00d');
      expect(model.lastFetchedAt).toEqual(new Date('2026-04-22T12:00:00.000Z'));
      expect(model.lastStatus).toBe('fetch_error');
    });

    it('applies safe defaults for missing fields', () => {
      const model = ImportSource.fromObject({});

      expect(model.enabled).toBe(true);
      expect(model.verificationType).toBe('dns-txt');
      expect(model.verificationState).toBe('unverified');
      expect(model.verifiedAt).toBeNull();
      expect(model.lastStatus).toBeNull();
    });

    it('accepts Date instances as well as ISO strings', () => {
      const model = ImportSource.fromObject({
        id: 'src-1',
        calendarId: 'cal-1',
        url: 'https://example.com/cal.ics',
        verifiedAt: new Date('2026-04-22T10:00:00.000Z'),
      });

      expect(model.verifiedAt).toEqual(new Date('2026-04-22T10:00:00.000Z'));
    });

    it('collapses invalid date strings to null', () => {
      const model = ImportSource.fromObject({
        id: 'src-1',
        calendarId: 'cal-1',
        url: 'https://example.com/cal.ics',
        verifiedAt: 'not-a-date',
      });

      expect(model.verifiedAt).toBeNull();
    });

    it('round-trips through toObject/fromObject', () => {
      const original = new ImportSource('src-1', 'cal-1', 'https://example.com/cal.ics');
      original.enabled = false;
      original.verificationState = 'verified';
      original.verifiedAt = new Date('2026-04-22T10:00:00.000Z');
      original.etag = 'W/"abc"';
      original.contentHash = 'hash';
      original.lastStatus = 'ok';

      const roundTripped = ImportSource.fromObject(original.toObject());

      expect(roundTripped.toObject()).toEqual(original.toObject());
    });
  });
});
