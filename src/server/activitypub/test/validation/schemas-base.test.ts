/**
 * Tests for ActivityPub validation schemas - base/shared schemas.
 *
 * Covers the building-block schemas (URIs, context, recipients, timestamps,
 * object references, activity-type enum, and the activity base) that all
 * activity-type schemas extend. Activity-type schemas are exercised in the
 * sibling schemas-activities.test.ts file.
 */

import { describe, it, expect } from 'vitest';

import {
  actorUriSchema,
  objectUriSchema,
  contextSchema,
  recipientSchema,
  objectReferenceSchema,
  timestampSchema,
  activityBaseSchema,
  activityTypeSchema,
  ACTIVITY_TYPES,
} from '@/server/activitypub/validation/schemas';

describe('ActivityPub Validation Schemas - Base', () => {
  describe('actorUriSchema', () => {
    it('should accept valid HTTPS URLs', () => {
      const validUrls = [
        'https://example.com/users/alice',
        'https://mastodon.social/@user',
        'https://remote.instance/calendars/test-calendar',
        'https://sub.domain.example.com/path/to/actor',
      ];

      for (const url of validUrls) {
        const result = actorUriSchema.safeParse(url);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(url);
        }
      }
    });

    it('should allow HTTP URLs in test environment', () => {
      // HTTP URLs are allowed in test/development environments
      const result = actorUriSchema.safeParse('http://example.com/users/alice');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('http://example.com/users/alice');
      }
    });

    it('should reject invalid URLs', () => {
      const invalidUrls = [
        'not-a-url',
        '',
        'example.com/users/alice',
      ];

      for (const url of invalidUrls) {
        const result = actorUriSchema.safeParse(url);
        expect(result.success, `Expected ${url} to be rejected`).toBe(false);
      }
    });

    it('should accept FTP URLs in test environment (too permissive)', () => {
      // TODO: actorUriSchema only enforces https:// in production via the
      // NODE_ENV refine in src/server/activitypub/validation/schemas.ts. In
      // test/dev environments any URL scheme is accepted (including ftp://),
      // which is broader than the AP spec intends. The production guard is
      // exercised by integration tests; this case documents the lax test-mode
      // behavior so a future tightening of the schema (e.g. an http/https
      // allowlist that applies in all environments) doesn't silently pass.
      const result = actorUriSchema.safeParse('ftp://example.com/user');
      expect(result.success).toBe(true);
    });

    it('should reject non-string values', () => {
      const invalidValues = [123, null, undefined, {}, []];

      for (const value of invalidValues) {
        const result = actorUriSchema.safeParse(value);
        expect(result.success).toBe(false);
      }
    });
  });

  describe('objectUriSchema', () => {
    it('should accept valid URLs', () => {
      const validUrls = [
        'https://example.com/objects/123',
        'https://remote.instance/events/abc-def',
        'http://localhost:3000/test', // HTTP allowed for development
      ];

      for (const url of validUrls) {
        const result = objectUriSchema.safeParse(url);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(url);
        }
      }
    });

    it('should reject invalid URLs', () => {
      const invalidUrls = [
        'not-a-url',
        '',
        'example.com/objects/123',
      ];

      for (const url of invalidUrls) {
        const result = objectUriSchema.safeParse(url);
        expect(result.success).toBe(false);
      }
    });
  });

  describe('contextSchema', () => {
    it('should accept a single string', () => {
      const result = contextSchema.safeParse('https://www.w3.org/ns/activitystreams');
      expect(result.success).toBe(true);
    });

    it('should accept an array of strings', () => {
      const result = contextSchema.safeParse([
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1',
      ]);
      expect(result.success).toBe(true);
    });

    it('should accept an array with objects', () => {
      const result = contextSchema.safeParse([
        'https://www.w3.org/ns/activitystreams',
        { '@language': 'en' },
      ]);
      expect(result.success).toBe(true);
    });

    it('should reject non-string, non-array values', () => {
      const invalidContexts = [123, null, undefined, true];

      for (const context of invalidContexts) {
        const result = contextSchema.safeParse(context);
        expect(result.success, `Expected ${String(context)} to be rejected`).toBe(false);
      }
    });
  });

  describe('recipientSchema', () => {
    it('should accept a single string', () => {
      const result = recipientSchema.safeParse('https://www.w3.org/ns/activitystreams#Public');
      expect(result.success).toBe(true);
    });

    it('should accept an array of strings', () => {
      const result = recipientSchema.safeParse([
        'https://example.com/users/alice',
        'https://example.com/users/bob',
      ]);
      expect(result.success).toBe(true);
    });

    it('should accept undefined (optional)', () => {
      const result = recipientSchema.safeParse(undefined);
      expect(result.success).toBe(true);
    });

    it('should reject invalid recipient values', () => {
      const invalidRecipients = [
        'not-a-url',
        ['https://example.com/valid', 'not-a-url'],
        123,
        {},
      ];

      for (const recipient of invalidRecipients) {
        const result = recipientSchema.safeParse(recipient);
        expect(result.success, `Expected ${JSON.stringify(recipient)} to be rejected`).toBe(false);
      }
    });
  });

  describe('objectReferenceSchema', () => {
    it('should accept a URI string', () => {
      const objectUri = 'https://example.com/objects/123';
      expect(() => objectReferenceSchema.parse(objectUri)).not.toThrow();
    });

    it('should accept an embedded object with id and type', () => {
      const embeddedObject = {
        id: 'https://example.com/objects/123',
        type: 'Event',
      };
      expect(() => objectReferenceSchema.parse(embeddedObject)).not.toThrow();
    });

    it('should accept an embedded object with additional properties', () => {
      const embeddedObject = {
        id: 'https://example.com/objects/123',
        type: 'Event',
        name: 'Test Event',
        startTime: '2025-02-05T10:00:00Z',
      };
      expect(() => objectReferenceSchema.parse(embeddedObject)).not.toThrow();
    });

    it('should reject objects without required fields', () => {
      const invalidObjects = [
        { id: 'https://example.com/objects/123' }, // Missing type
        { name: 'Test' }, // Missing type (id is optional)
      ];

      for (const obj of invalidObjects) {
        expect(() => objectReferenceSchema.parse(obj)).toThrow();
      }
    });

    it('should accept embedded objects without id (for Create activities)', () => {
      const objectWithoutId = {
        type: 'Event',
        name: 'Test Event',
        content: { en: { name: 'Test' } },
      };

      expect(() => objectReferenceSchema.parse(objectWithoutId)).not.toThrow();
    });

    it('should reject invalid values', () => {
      const invalidValues = [null, undefined, 123, true, 'not-a-url'];

      for (const value of invalidValues) {
        expect(() => objectReferenceSchema.parse(value)).toThrow();
      }
    });
  });

  describe('timestampSchema', () => {
    it('should accept valid ISO 8601 datetime strings', () => {
      const validTimestamps = [
        '2025-02-04T12:00:00Z',
        '2025-02-04T12:00:00.000Z',
        '2025-02-04T12:00:00+00:00',
        '2025-02-04T12:00:00-05:00',
      ];

      for (const timestamp of validTimestamps) {
        expect(() => timestampSchema.parse(timestamp)).not.toThrow();
      }
    });

    it('should accept undefined (optional field)', () => {
      expect(() => timestampSchema.parse(undefined)).not.toThrow();
    });

    it('should reject invalid datetime strings', () => {
      // Note: '2025-02-04T12:00:00' (no timezone) is rejected here. Real-world
      // non-compliant AP servers (e.g. Gancio) sometimes emit bare local
      // timestamps; the schema requires an explicit Z or +/-HH:MM offset.
      const invalidTimestamps = [
        '2025-02-04', // Date only, no time
        '12:00:00', // Time only, no date
        'not-a-date', // Not a date
        '2025-02-04 12:00:00', // Space instead of T
        '2025-02-04T12:00:00', // Missing timezone
      ];

      for (const timestamp of invalidTimestamps) {
        expect(() => timestampSchema.parse(timestamp)).toThrow();
      }
    });

    it('should reject non-string values', () => {
      const invalidValues = [123, new Date(), {}, []];

      for (const value of invalidValues) {
        expect(() => timestampSchema.parse(value)).toThrow();
      }
    });
  });

  describe('activityBaseSchema', () => {
    it('should accept a valid activity', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/123',
        type: 'Create',
        actor: 'https://example.com/users/alice',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: ['https://example.com/users/alice/followers'],
      };

      const result = activityBaseSchema.safeParse(validActivity);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Create');
        expect(result.data.actor).toBe('https://example.com/users/alice');
      }
    });

    it('should accept an activity with array context', () => {
      const validActivity = {
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://w3id.org/security/v1',
        ],
        id: 'https://example.com/activities/123',
        type: 'Follow',
        actor: 'https://example.com/users/alice',
      };

      const result = activityBaseSchema.safeParse(validActivity);
      expect(result.success).toBe(true);
    });

    it('should accept an activity without to/cc fields', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/123',
        type: 'Accept',
        actor: 'https://example.com/users/alice',
      };

      const result = activityBaseSchema.safeParse(validActivity);
      expect(result.success).toBe(true);
    });

    it('should allow HTTP actor in test environment', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/123',
        type: 'Create',
        actor: 'http://example.com/users/alice', // HTTP allowed in test environment
      };

      const result = activityBaseSchema.safeParse(validActivity);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.actor).toBe('http://example.com/users/alice');
      }
    });

    it('should reject an activity without required fields', () => {
      const missingFields = [
        { '@context': 'https://www.w3.org/ns/activitystreams', id: 'https://example.com/1', type: 'Create' }, // missing actor
        { '@context': 'https://www.w3.org/ns/activitystreams', id: 'https://example.com/1', actor: 'https://example.com/users/alice' }, // missing type
        { '@context': 'https://www.w3.org/ns/activitystreams', type: 'Create', actor: 'https://example.com/users/alice' }, // missing id
        { id: 'https://example.com/1', type: 'Create', actor: 'https://example.com/users/alice' }, // missing @context
      ];

      for (const activity of missingFields) {
        const result = activityBaseSchema.safeParse(activity);
        expect(result.success).toBe(false);
      }
    });

    it('should reject an activity with empty type', () => {
      const invalidActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/123',
        type: '',
        actor: 'https://example.com/users/alice',
      };

      const result = activityBaseSchema.safeParse(invalidActivity);
      expect(result.success).toBe(false);
      if (!result.success) {
        const typeError = result.error.issues.find(
          (issue) => issue.path.includes('type'),
        );
        expect(typeError).toBeDefined();
        expect(typeError?.message).toBe('Activity type is required');
      }
    });

    it('should reject an activity with invalid id URL', () => {
      const invalidActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'not-a-valid-url',
        type: 'Create',
        actor: 'https://example.com/users/alice',
      };

      const result = activityBaseSchema.safeParse(invalidActivity);
      expect(result.success).toBe(false);
      if (!result.success) {
        const idError = result.error.issues.find(
          (issue) => issue.path.includes('id'),
        );
        expect(idError).toBeDefined();
      }
    });
  });

  describe('activityTypeSchema', () => {
    it('should accept all defined activity types', () => {
      for (const type of ACTIVITY_TYPES) {
        expect(() => activityTypeSchema.parse(type)).not.toThrow();
      }
    });

    it('should include common ActivityPub activity types', () => {
      const commonTypes = [
        'Create',
        'Update',
        'Delete',
        'Follow',
        'Accept',
        'Reject',
        'Announce',
        'Undo',
      ];

      for (const type of commonTypes) {
        expect(ACTIVITY_TYPES).toContain(type);
      }
    });

    it('should reject undefined activity types', () => {
      const invalidTypes = [
        'InvalidType',
        'create', // lowercase
        'CREATE', // uppercase
        '',
      ];

      for (const type of invalidTypes) {
        expect(() => activityTypeSchema.parse(type)).toThrow();
      }
    });
  });
});
