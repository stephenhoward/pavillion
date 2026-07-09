import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { ImportSource } from '@/common/model/import_source';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';

describe('ImportSourceEntity', () => {

  describe('fromModel', () => {
    it('creates an entity from an ImportSource domain model', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const model = new ImportSource(id, calendarId, 'https://example.com/cal.ics');
      model.enabled = false;
      model.verificationType = 'dns-txt';
      model.verificationState = 'verified';
      model.verifiedAt = new Date('2026-04-22T10:00:00Z');
      model.verificationExpiresAt = new Date('2026-10-22T10:00:00Z');
      model.etag = 'W/"abc123"';
      model.contentHash = 'cafef00d';
      model.lastFetchedAt = new Date('2026-04-22T12:00:00Z');
      model.lastStatus = 'ok';

      const entity = ImportSourceEntity.fromModel(model);

      expect(entity.id).toBe(id);
      expect(entity.calendar_id).toBe(calendarId);
      expect(entity.url).toBe('https://example.com/cal.ics');
      expect(entity.enabled).toBe(false);
      expect(entity.verification_type).toBe('dns-txt');
      expect(entity.verification_state).toBe('verified');
      expect(entity.verified_at).toEqual(new Date('2026-04-22T10:00:00Z'));
      expect(entity.verification_expires_at).toEqual(new Date('2026-10-22T10:00:00Z'));
      expect(entity.etag).toBe('W/"abc123"');
      expect(entity.content_hash).toBe('cafef00d');
      expect(entity.last_fetched_at).toEqual(new Date('2026-04-22T12:00:00Z'));
      expect(entity.last_status).toBe('ok');
    });

    it('does not copy a verification_token from the domain model (owner-only secret)', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const model = new ImportSource(id, calendarId, 'https://example.com/cal.ics');
      // The domain model intentionally has no verificationToken field;
      // attempting to smuggle one in must not result in it being persisted.
      (model as any).verificationToken = 'should-not-persist';

      const entity = ImportSourceEntity.fromModel(model);

      expect(entity.verification_token ?? null).toBeNull();
    });
  });

  describe('toModel', () => {
    it('converts an entity to an ImportSource domain model', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const entity = ImportSourceEntity.build({
        id,
        calendar_id: calendarId,
        url: 'https://example.com/cal.ics',
        enabled: true,
        verification_type: 'dns-txt',
        verification_state: 'pending',
        verification_token: 'secret-token',
        verified_at: null,
        verification_expires_at: null,
        etag: null,
        content_hash: null,
        last_fetched_at: null,
        last_status: null,
      });

      const model = entity.toModel();

      expect(model).toBeInstanceOf(ImportSource);
      expect(model.id).toBe(id);
      expect(model.calendarId).toBe(calendarId);
      expect(model.url).toBe('https://example.com/cal.ics');
      expect(model.enabled).toBe(true);
      expect(model.verificationType).toBe('dns-txt');
      expect(model.verificationState).toBe('pending');
      expect(model.verifiedAt).toBeNull();
      expect(model.lastStatus).toBeNull();
    });

    it('never copies verification_token onto the domain model', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const entity = ImportSourceEntity.build({
        id,
        calendar_id: calendarId,
        url: 'https://example.com/cal.ics',
        verification_state: 'pending',
        verification_token: 'very-secret',
      });

      const model = entity.toModel();

      expect((model as any).verificationToken).toBeUndefined();
      expect(model.toObject()).not.toHaveProperty('verificationToken');
    });
  });

  describe('round-trip conversion', () => {
    it('preserves data integrity through fromModel -> toModel', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const original = new ImportSource(id, calendarId, 'https://example.com/cal.ics');
      original.enabled = false;
      original.verificationType = 'dns-txt';
      original.verificationState = 'verified';
      original.verifiedAt = new Date('2026-04-22T10:00:00Z');
      original.etag = 'W/"abc"';
      original.contentHash = 'hash';
      original.lastStatus = 'ok';

      const entity = ImportSourceEntity.fromModel(original);
      const roundTrip = entity.toModel();

      expect(roundTrip.id).toBe(original.id);
      expect(roundTrip.calendarId).toBe(original.calendarId);
      expect(roundTrip.url).toBe(original.url);
      expect(roundTrip.enabled).toBe(original.enabled);
      expect(roundTrip.verificationType).toBe(original.verificationType);
      expect(roundTrip.verificationState).toBe(original.verificationState);
      expect(roundTrip.verifiedAt).toEqual(original.verifiedAt);
      expect(roundTrip.etag).toBe(original.etag);
      expect(roundTrip.contentHash).toBe(original.contentHash);
      expect(roundTrip.lastStatus).toBe(original.lastStatus);
    });
  });

  describe('file-upload fields (sourceType / originalFilename)', () => {
    it('round-trips sourceType and originalFilename through fromModel -> toModel', () => {
      const id = uuidv4();
      const calendarId = uuidv4();
      const model = new ImportSource(id, calendarId, null);
      model.sourceType = 'file';
      model.originalFilename = 'exported-events.ics';

      const entity = ImportSourceEntity.fromModel(model);
      expect(entity.source_type).toBe('file');
      expect(entity.original_filename).toBe('exported-events.ics');
      expect(entity.url ?? null).toBeNull();

      const roundTrip = entity.toModel();
      expect(roundTrip.sourceType).toBe('file');
      expect(roundTrip.originalFilename).toBe('exported-events.ics');
      expect(roundTrip.url ?? null).toBeNull();
    });

    it('defaults sourceType to url and originalFilename to null on a bare model', () => {
      const model = new ImportSource();
      expect(model.sourceType).toBe('url');
      expect(model.originalFilename).toBeNull();
    });
  });

  describe('verification_type column defaults', () => {
    it('does not stamp a verification_type when not specified on build', () => {
      // The column is nullable with no DB default. An entity built without
      // an explicit verification_type carries the "no method chosen yet"
      // signal — falsy on read — so the verify-ownership wizard knows to
      // show the method picker on first entry.
      const id = uuidv4();
      const calendarId = uuidv4();
      const entity = ImportSourceEntity.build({
        id,
        calendar_id: calendarId,
        url: 'https://example.com/cal.ics',
        verification_state: 'unverified',
      });

      expect(entity.verification_type).toBeFalsy();
    });

    it('round-trips an explicit verificationType through fromModel -> toModel', () => {
      // With only one enum value today this can't discriminate a hypothetical
      // "always returns default" bug from correct behavior — it simply
      // verifies the field is carried through fromModel/toModel. Future
      // verifier beads that add new enum values can strengthen this check.
      const id = uuidv4();
      const calendarId = uuidv4();
      const model = new ImportSource(id, calendarId, 'https://example.com/cal.ics');
      model.verificationType = 'dns-txt';

      const entity = ImportSourceEntity.fromModel(model);
      expect(entity.verification_type).toBe('dns-txt');

      const roundTrip = entity.toModel();
      expect(roundTrip.verificationType).toBe('dns-txt');
    });
  });
});
