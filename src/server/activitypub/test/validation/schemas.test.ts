/**
 * Tests for ActivityPub validation schemas
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
  objectBaseSchema,
  activityTypeSchema,
  ACTIVITY_TYPES,
} from '@/server/activitypub/validation/schemas';

describe('ActivityPub Validation Schemas', () => {
  describe('actorUriSchema', () => {
    it('should accept valid HTTPS URLs', () => {
      const validUrls = [
        'https://example.com/users/alice',
        'https://social.example.org/actors/bob',
        'https://mastodon.social/@user',
      ];

      for (const url of validUrls) {
        expect(() => actorUriSchema.parse(url)).not.toThrow();
      }
    });

    it('should accept HTTP URLs in development/test mode', () => {
      const httpUrl = 'http://localhost:3000/users/test';

      // Should work in test environment
      expect(() => actorUriSchema.parse(httpUrl)).not.toThrow();
    });

    it('should reject invalid URLs', () => {
      const invalidUrls = [
        '',
        'not-a-url',
        'relative/path',
      ];

      for (const url of invalidUrls) {
        expect(() => actorUriSchema.parse(url)).toThrow();
      }
    });

    it('should reject non-string values', () => {
      const invalidValues = [null, undefined, 123, {}, []];

      for (const value of invalidValues) {
        expect(() => actorUriSchema.parse(value)).toThrow();
      }
    });
  });

  describe('objectUriSchema', () => {
    it('should accept valid URLs', () => {
      const validUrls = [
        'https://example.com/objects/123',
        'http://localhost:3000/events/456',
        'https://calendar.example.org/events/event-id',
      ];

      for (const url of validUrls) {
        expect(() => objectUriSchema.parse(url)).not.toThrow();
      }
    });

    it('should reject invalid URLs', () => {
      const invalidUrls = [
        '',
        'not-a-url',
        'relative/path',
      ];

      for (const url of invalidUrls) {
        expect(() => objectUriSchema.parse(url)).toThrow();
      }
    });
  });

  describe('contextSchema', () => {
    it('should accept a single string context', () => {
      const context = 'https://www.w3.org/ns/activitystreams';
      expect(() => contextSchema.parse(context)).not.toThrow();
    });

    it('should accept an array of string contexts', () => {
      const context = [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1',
      ];
      expect(() => contextSchema.parse(context)).not.toThrow();
    });

    it('should accept an array with mixed strings and objects', () => {
      const context = [
        'https://www.w3.org/ns/activitystreams',
        {
          '@vocab': 'https://www.w3.org/ns/activitystreams',
          'sensitive': 'as:sensitive',
        },
      ];
      expect(() => contextSchema.parse(context)).not.toThrow();
    });

    it('should reject invalid context values', () => {
      const invalidContexts = [null, undefined, 123, true];

      for (const context of invalidContexts) {
        expect(() => contextSchema.parse(context)).toThrow();
      }
    });
  });

  describe('recipientSchema', () => {
    it('should accept a single recipient URI', () => {
      const recipient = 'https://example.com/users/alice';
      expect(() => recipientSchema.parse(recipient)).not.toThrow();
    });

    it('should accept an array of recipient URIs', () => {
      const recipients = [
        'https://example.com/users/alice',
        'https://example.com/users/bob',
        'https://www.w3.org/ns/activitystreams#Public',
      ];
      expect(() => recipientSchema.parse(recipients)).not.toThrow();
    });

    it('should accept undefined (optional field)', () => {
      expect(() => recipientSchema.parse(undefined)).not.toThrow();
    });

    it('should reject invalid recipient values', () => {
      const invalidRecipients = [
        'not-a-url',
        ['https://example.com/valid', 'not-a-url'],
        123,
        {},
      ];

      for (const recipient of invalidRecipients) {
        expect(() => recipientSchema.parse(recipient)).toThrow();
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
    it('should accept a valid activity with all required fields', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/123',
        type: 'Create',
        actor: 'https://example.com/users/alice',
      };

      expect(() => activityBaseSchema.parse(validActivity)).not.toThrow();
    });

    it('should accept an activity with optional fields', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/123',
        type: 'Create',
        actor: 'https://example.com/users/alice',
        to: 'https://www.w3.org/ns/activitystreams#Public',
        cc: ['https://example.com/users/bob'],
        published: '2025-02-04T12:00:00Z',
        updated: '2025-02-04T12:30:00Z',
      };

      expect(() => activityBaseSchema.parse(validActivity)).not.toThrow();
    });

    it('should reject activities missing required fields', () => {
      const invalidActivities = [
        {
          // Missing @context
          id: 'https://example.com/activities/123',
          type: 'Create',
          actor: 'https://example.com/users/alice',
        },
        {
          // Missing id
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Create',
          actor: 'https://example.com/users/alice',
        },
        {
          // Missing type
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://example.com/activities/123',
          actor: 'https://example.com/users/alice',
        },
        {
          // Missing actor
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://example.com/activities/123',
          type: 'Create',
        },
      ];

      for (const activity of invalidActivities) {
        expect(() => activityBaseSchema.parse(activity)).toThrow();
      }
    });

    it('should reject activities with invalid field values', () => {
      const invalidActivities = [
        {
          '@context': 123, // Invalid context
          id: 'https://example.com/activities/123',
          type: 'Create',
          actor: 'https://example.com/users/alice',
        },
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'not-a-url', // Invalid id
          type: 'Create',
          actor: 'https://example.com/users/alice',
        },
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://example.com/activities/123',
          type: '', // Empty type
          actor: 'https://example.com/users/alice',
        },
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://example.com/activities/123',
          type: 'Create',
          actor: 'not-a-url', // Invalid actor
        },
      ];

      for (const activity of invalidActivities) {
        expect(() => activityBaseSchema.parse(activity)).toThrow();
      }
    });
  });

  describe('objectBaseSchema', () => {
    it('should accept a valid object with minimal fields', () => {
      const validObject = {
        type: 'Event',
      };

      expect(() => objectBaseSchema.parse(validObject)).not.toThrow();
    });

    it('should accept an object with all optional fields', () => {
      const validObject = {
        id: 'https://example.com/objects/123',
        type: 'Event',
        attributedTo: 'https://example.com/users/alice',
        published: '2025-02-04T12:00:00Z',
        updated: '2025-02-04T12:30:00Z',
        to: 'https://www.w3.org/ns/activitystreams#Public',
        cc: ['https://example.com/users/bob'],
      };

      expect(() => objectBaseSchema.parse(validObject)).not.toThrow();
    });

    it('should accept an object with multiple attributedTo values', () => {
      const validObject = {
        type: 'Event',
        attributedTo: [
          'https://example.com/users/alice',
          'https://example.com/users/bob',
        ],
      };

      expect(() => objectBaseSchema.parse(validObject)).not.toThrow();
    });

    it('should accept objects with additional properties (passthrough)', () => {
      const validObject = {
        type: 'Event',
        name: 'Test Event',
        content: 'Event description',
        startTime: '2025-02-05T10:00:00Z',
        location: 'Test Location',
      };

      expect(() => objectBaseSchema.parse(validObject)).not.toThrow();
    });

    it('should reject objects without required type field', () => {
      const invalidObject = {
        id: 'https://example.com/objects/123',
      };

      expect(() => objectBaseSchema.parse(invalidObject)).toThrow();
    });

    it('should reject objects with invalid field values', () => {
      const invalidObjects = [
        {
          type: 'Event',
          id: 'not-a-url', // Invalid id
        },
        {
          type: 'Event',
          attributedTo: 'not-a-url', // Invalid attributedTo
        },
        {
          type: 'Event',
          published: 'not-a-datetime', // Invalid published
        },
      ];

      for (const obj of invalidObjects) {
        expect(() => objectBaseSchema.parse(obj)).toThrow();
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
