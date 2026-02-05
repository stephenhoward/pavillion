import { describe, it, expect } from 'vitest';

import {
  actorUriSchema,
  objectUriSchema,
  activityBaseSchema,
  contextSchema,
  recipientSchema,
  createActivitySchema,
  updateActivitySchema,
  deleteActivitySchema,
  followActivitySchema,
  acceptActivitySchema,
  announceActivitySchema,
  undoActivitySchema,
} from '@/server/activitypub/validation/schemas';

describe('ActivityPub Validation Schemas', () => {
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
      // Note: In test/dev environments, the schema accepts any valid URL scheme
      // This is probably too permissive but reflects current schema behavior
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
      const result = contextSchema.safeParse(123);
      expect(result.success).toBe(false);
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

  describe('followActivitySchema', () => {
    it('should accept a valid Follow activity', () => {
      const validFollow = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/123',
        type: 'Follow',
        actor: 'https://example.com/users/alice',
        object: 'https://remote.example/calendars/events',
      };

      const result = followActivitySchema.safeParse(validFollow);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Follow');
        expect(result.data.actor).toBe('https://example.com/users/alice');
        expect(result.data.object).toBe('https://remote.example/calendars/events');
      }
    });

    it('should accept a Follow activity with array context', () => {
      const validFollow = {
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://w3id.org/security/v1',
        ],
        id: 'https://example.com/activities/456',
        type: 'Follow',
        actor: 'https://example.com/users/bob',
        object: 'https://remote.example/users/charlie',
      };

      const result = followActivitySchema.safeParse(validFollow);
      expect(result.success).toBe(true);
    });

    it('should accept a Follow activity with optional recipient fields', () => {
      const validFollow = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/789',
        type: 'Follow',
        actor: 'https://example.com/users/alice',
        object: 'https://remote.example/calendars/events',
        to: ['https://remote.example/calendars/events'],
        cc: ['https://www.w3.org/ns/activitystreams#Public'],
      };

      const result = followActivitySchema.safeParse(validFollow);
      expect(result.success).toBe(true);
    });

    it('should accept HTTP URLs in test environment', () => {
      const validFollow = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/123',
        type: 'Follow',
        actor: 'http://localhost:3000/users/alice',
        object: 'http://localhost:3000/calendars/test',
      };

      const result = followActivitySchema.safeParse(validFollow);
      expect(result.success).toBe(true);
    });

    it('should reject Follow activity with wrong type', () => {
      const invalidFollow = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/123',
        type: 'Create', // Wrong type
        actor: 'https://example.com/users/alice',
        object: 'https://remote.example/calendars/events',
      };

      const result = followActivitySchema.safeParse(invalidFollow);
      expect(result.success).toBe(false);
    });

    it('should reject Follow activity without required fields', () => {
      const missingFields = [
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://example.com/1',
          type: 'Follow',
          actor: 'https://example.com/users/alice',
          // missing object
        },
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://example.com/1',
          type: 'Follow',
          object: 'https://remote.example/calendars/events',
          // missing actor
        },
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Follow',
          actor: 'https://example.com/users/alice',
          object: 'https://remote.example/calendars/events',
          // missing id
        },
      ];

      for (const activity of missingFields) {
        const result = followActivitySchema.safeParse(activity);
        expect(result.success).toBe(false);
      }
    });

    it('should reject Follow activity with invalid object URL', () => {
      const invalidFollow = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/123',
        type: 'Follow',
        actor: 'https://example.com/users/alice',
        object: 'not-a-valid-url',
      };

      const result = followActivitySchema.safeParse(invalidFollow);
      expect(result.success).toBe(false);
    });

    it('should reject Follow activity with object as embedded object', () => {
      // Follow activities should have object as URI, not embedded object
      const invalidFollow = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/123',
        type: 'Follow',
        actor: 'https://example.com/users/alice',
        object: {
          id: 'https://remote.example/calendars/events',
          type: 'Calendar',
        },
      };

      const result = followActivitySchema.safeParse(invalidFollow);
      expect(result.success).toBe(false);
    });
  });

  describe('acceptActivitySchema', () => {
    it('should accept a valid Accept activity with URI object', () => {
      const validAccept = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example/activities/456',
        type: 'Accept',
        actor: 'https://remote.example/calendars/events',
        object: 'https://example.com/activities/123',
      };

      const result = acceptActivitySchema.safeParse(validAccept);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Accept');
        expect(result.data.actor).toBe('https://remote.example/calendars/events');
        expect(result.data.object).toBe('https://example.com/activities/123');
      }
    });

    it('should accept a valid Accept activity with embedded Follow object', () => {
      const validAccept = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example/activities/456',
        type: 'Accept',
        actor: 'https://remote.example/calendars/events',
        object: {
          id: 'https://example.com/activities/123',
          type: 'Follow',
          actor: 'https://example.com/users/alice',
          object: 'https://remote.example/calendars/events',
        },
      };

      const result = acceptActivitySchema.safeParse(validAccept);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Accept');
        expect(typeof result.data.object).toBe('object');
        if (typeof result.data.object === 'object') {
          expect(result.data.object.type).toBe('Follow');
        }
      }
    });

    it('should accept Accept activity with published timestamp', () => {
      const validAccept = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example/activities/456',
        type: 'Accept',
        actor: 'https://remote.example/calendars/events',
        object: 'https://example.com/activities/123',
        published: '2025-02-04T12:00:00Z',
      };

      const result = acceptActivitySchema.safeParse(validAccept);
      expect(result.success).toBe(true);
    });

    it('should accept Accept activity with recipient fields', () => {
      const validAccept = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example/activities/456',
        type: 'Accept',
        actor: 'https://remote.example/calendars/events',
        object: 'https://example.com/activities/123',
        to: ['https://example.com/users/alice'],
        cc: ['https://www.w3.org/ns/activitystreams#Public'],
      };

      const result = acceptActivitySchema.safeParse(validAccept);
      expect(result.success).toBe(true);
    });

    it('should accept HTTP URLs in test environment', () => {
      const validAccept = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/456',
        type: 'Accept',
        actor: 'http://localhost:3000/calendars/test',
        object: 'http://localhost:3000/activities/123',
      };

      const result = acceptActivitySchema.safeParse(validAccept);
      expect(result.success).toBe(true);
    });

    it('should reject Accept activity with wrong type', () => {
      const invalidAccept = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example/activities/456',
        type: 'Reject', // Wrong type
        actor: 'https://remote.example/calendars/events',
        object: 'https://example.com/activities/123',
      };

      const result = acceptActivitySchema.safeParse(invalidAccept);
      expect(result.success).toBe(false);
    });

    it('should reject Accept activity without required fields', () => {
      const missingFields = [
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://example.com/1',
          type: 'Accept',
          actor: 'https://remote.example/calendars/events',
          // missing object
        },
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://example.com/1',
          type: 'Accept',
          object: 'https://example.com/activities/123',
          // missing actor
        },
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Accept',
          actor: 'https://remote.example/calendars/events',
          object: 'https://example.com/activities/123',
          // missing id
        },
      ];

      for (const activity of missingFields) {
        const result = acceptActivitySchema.safeParse(activity);
        expect(result.success).toBe(false);
      }
    });

    it('should reject Accept activity with invalid object URL', () => {
      const invalidAccept = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example/activities/456',
        type: 'Accept',
        actor: 'https://remote.example/calendars/events',
        object: 'not-a-valid-url',
      };

      const result = acceptActivitySchema.safeParse(invalidAccept);
      expect(result.success).toBe(false);
    });

    it('should reject Accept activity with embedded object missing required type field', () => {
      const invalidAccept = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example/activities/456',
        type: 'Accept',
        actor: 'https://remote.example/calendars/events',
        object: {
          // Missing type (id is optional)
          id: 'https://remote.example/activities/123',
        },
      };

      const result = acceptActivitySchema.safeParse(invalidAccept);
      expect(result.success).toBe(false);
    });

    it('should accept Accept activity with embedded object missing id (for Create activities)', () => {
      const validAccept = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example/activities/456',
        type: 'Accept',
        actor: 'https://remote.example/calendars/events',
        object: {
          type: 'Follow',
          // id is optional in schema (though typically present for Accept/Undo)
          actor: 'https://remote.example/users/alice',
          object: 'https://local.example/calendars/events',
        },
      };

      const result = acceptActivitySchema.safeParse(validAccept);
      expect(result.success).toBe(true);
    });

    it('should accept Accept activity with complex embedded Follow', () => {
      const validAccept = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example/activities/456',
        type: 'Accept',
        actor: 'https://remote.example/calendars/events',
        object: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://example.com/activities/123',
          type: 'Follow',
          actor: 'https://example.com/users/alice',
          object: 'https://remote.example/calendars/events',
          published: '2025-02-04T11:00:00Z',
          to: ['https://remote.example/calendars/events'],
        },
        published: '2025-02-04T12:00:00Z',
      };

      const result = acceptActivitySchema.safeParse(validAccept);
      expect(result.success).toBe(true);
    });
  });

  describe('createActivitySchema', () => {
    it('should accept a valid Create activity with embedded object', () => {
      const validCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-123',
        type: 'Create',
        actor: 'https://example.com/users/alice',
        object: {
          id: 'https://example.com/events/event-123',
          type: 'Event',
          name: 'Test Event',
          startTime: '2025-03-15T14:00:00Z',
        },
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: ['https://example.com/users/alice/followers'],
        published: '2025-02-04T12:00:00Z',
      };

      const result = createActivitySchema.safeParse(validCreate);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Create');
        expect(result.data.actor).toBe('https://example.com/users/alice');
        expect(result.data.object).toBeDefined();
        if (typeof result.data.object === 'object') {
          expect(result.data.object.id).toBe('https://example.com/events/event-123');
          expect(result.data.object.type).toBe('Event');
        }
      }
    });

    it('should accept a valid Create activity with object URI reference', () => {
      const validCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-456',
        type: 'Create',
        actor: 'https://example.com/users/bob',
        object: 'https://example.com/events/event-456',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
      };

      const result = createActivitySchema.safeParse(validCreate);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Create');
        expect(result.data.object).toBe('https://example.com/events/event-456');
      }
    });

    it('should accept a Create activity with minimal required fields', () => {
      const minimalCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-789',
        type: 'Create',
        actor: 'https://example.com/users/charlie',
        object: {
          id: 'https://example.com/notes/note-789',
          type: 'Note',
        },
      };

      const result = createActivitySchema.safeParse(minimalCreate);
      expect(result.success).toBe(true);
    });

    it('should accept a Create activity with array context', () => {
      const validCreate = {
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://w3id.org/security/v1',
        ],
        id: 'https://example.com/activities/create-101',
        type: 'Create',
        actor: 'https://example.com/users/dave',
        object: {
          id: 'https://example.com/events/event-101',
          type: 'Event',
        },
      };

      const result = createActivitySchema.safeParse(validCreate);
      expect(result.success).toBe(true);
    });

    it('should accept a Create activity with multiple recipients', () => {
      const validCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-202',
        type: 'Create',
        actor: 'https://example.com/users/eve',
        object: 'https://example.com/events/event-202',
        to: [
          'https://www.w3.org/ns/activitystreams#Public',
          'https://example.com/users/alice',
        ],
        cc: [
          'https://example.com/users/eve/followers',
          'https://example.com/groups/community',
        ],
      };

      const result = createActivitySchema.safeParse(validCreate);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(Array.isArray(result.data.to)).toBe(true);
        expect(Array.isArray(result.data.cc)).toBe(true);
      }
    });

    it('should accept a Create activity with timestamp fields', () => {
      const validCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-303',
        type: 'Create',
        actor: 'https://example.com/users/frank',
        object: 'https://example.com/events/event-303',
        published: '2025-02-04T12:00:00Z',
        updated: '2025-02-04T13:30:00+00:00',
      };

      const result = createActivitySchema.safeParse(validCreate);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.published).toBe('2025-02-04T12:00:00Z');
        expect(result.data.updated).toBe('2025-02-04T13:30:00+00:00');
      }
    });

    it('should accept HTTP URLs in test environment', () => {
      const validCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'http://localhost:3000/activities/create-404',
        type: 'Create',
        actor: 'http://localhost:3000/users/testuser',
        object: 'http://localhost:3000/events/test-event',
      };

      const result = createActivitySchema.safeParse(validCreate);
      expect(result.success).toBe(true);
    });

    it('should reject a Create activity with missing type', () => {
      const invalidCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-500',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-500',
      };

      const result = createActivitySchema.safeParse(invalidCreate);
      expect(result.success).toBe(false);
    });

    it('should reject a Create activity with wrong type', () => {
      const invalidCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-501',
        type: 'Update', // Wrong type
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-501',
      };

      const result = createActivitySchema.safeParse(invalidCreate);
      expect(result.success).toBe(false);
      if (!result.success) {
        const typeError = result.error.issues.find(
          (issue) => issue.path.includes('type'),
        );
        expect(typeError).toBeDefined();
      }
    });

    it('should reject a Create activity with missing object', () => {
      const invalidCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-502',
        type: 'Create',
        actor: 'https://example.com/users/alice',
      };

      const result = createActivitySchema.safeParse(invalidCreate);
      expect(result.success).toBe(false);
      if (!result.success) {
        const objectError = result.error.issues.find(
          (issue) => issue.path.includes('object'),
        );
        expect(objectError).toBeDefined();
      }
    });

    it('should reject a Create activity with missing actor', () => {
      const invalidCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-503',
        type: 'Create',
        object: 'https://example.com/events/event-503',
      };

      const result = createActivitySchema.safeParse(invalidCreate);
      expect(result.success).toBe(false);
      if (!result.success) {
        const actorError = result.error.issues.find(
          (issue) => issue.path.includes('actor'),
        );
        expect(actorError).toBeDefined();
      }
    });

    it('should reject a Create activity with missing id', () => {
      const invalidCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Create',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-504',
      };

      const result = createActivitySchema.safeParse(invalidCreate);
      expect(result.success).toBe(false);
      if (!result.success) {
        const idError = result.error.issues.find(
          (issue) => issue.path.includes('id'),
        );
        expect(idError).toBeDefined();
      }
    });

    it('should reject a Create activity with missing @context', () => {
      const invalidCreate = {
        id: 'https://example.com/activities/create-505',
        type: 'Create',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-505',
      };

      const result = createActivitySchema.safeParse(invalidCreate);
      expect(result.success).toBe(false);
      if (!result.success) {
        const contextError = result.error.issues.find(
          (issue) => issue.path.includes('@context'),
        );
        expect(contextError).toBeDefined();
      }
    });

    it('should reject a Create activity with invalid object URL', () => {
      const invalidCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-506',
        type: 'Create',
        actor: 'https://example.com/users/alice',
        object: 'not-a-valid-url',
      };

      const result = createActivitySchema.safeParse(invalidCreate);
      expect(result.success).toBe(false);
    });

    it('should reject a Create activity with invalid actor URL', () => {
      const invalidCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-507',
        type: 'Create',
        actor: 'not-a-valid-url',
        object: 'https://example.com/events/event-507',
      };

      const result = createActivitySchema.safeParse(invalidCreate);
      expect(result.success).toBe(false);
    });

    it('should reject a Create activity with invalid id URL', () => {
      const invalidCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'not-a-valid-url',
        type: 'Create',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-508',
      };

      const result = createActivitySchema.safeParse(invalidCreate);
      expect(result.success).toBe(false);
    });

    it('should reject a Create activity with invalid to recipient URL', () => {
      const invalidCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-509',
        type: 'Create',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-509',
        to: 'not-a-valid-url',
      };

      const result = createActivitySchema.safeParse(invalidCreate);
      expect(result.success).toBe(false);
    });

    it('should reject a Create activity with invalid timestamp format', () => {
      const invalidCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-510',
        type: 'Create',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-510',
        published: 'not-a-valid-timestamp',
      };

      const result = createActivitySchema.safeParse(invalidCreate);
      expect(result.success).toBe(false);
      if (!result.success) {
        const publishedError = result.error.issues.find(
          (issue) => issue.path.includes('published'),
        );
        expect(publishedError).toBeDefined();
      }
    });

    it('should accept a Create activity with object missing id field (for newly created objects)', () => {
      const validCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-511',
        type: 'Create',
        actor: 'https://example.com/users/alice',
        object: {
          type: 'Event', // id is optional for newly created objects
          name: 'Test Event',
        },
      };

      const result = createActivitySchema.safeParse(validCreate);
      expect(result.success).toBe(true);
    });

    it('should reject a Create activity with object missing required type field', () => {
      const invalidCreate = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/create-512',
        type: 'Create',
        actor: 'https://example.com/users/alice',
        object: {
          id: 'https://example.com/events/event-512', // Missing type field
          name: 'Test Event',
        },
      };

      const result = createActivitySchema.safeParse(invalidCreate);
      expect(result.success).toBe(false);
      if (!result.success) {
        // Zod returns union errors for objectReferenceSchema, so we check the error message
        const errorMessage = JSON.stringify(result.error.issues);
        expect(errorMessage).toContain('type');
      }
    });
  });

  describe('updateActivitySchema', () => {
    it('should accept a valid Update activity with URI object', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/update/123',
        type: 'Update',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-123',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: ['https://example.com/users/alice/followers'],
      };

      const result = updateActivitySchema.safeParse(validActivity);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Update');
        expect(result.data.object).toBe('https://example.com/events/event-123');
      }
    });

    it('should accept a valid Update activity with embedded object', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/update/123',
        type: 'Update',
        actor: 'https://example.com/users/alice',
        object: {
          id: 'https://example.com/events/event-123',
          type: 'Event',
          name: 'Updated Event Name',
          startTime: '2025-03-01T10:00:00Z',
          endTime: '2025-03-01T12:00:00Z',
        },
        to: ['https://www.w3.org/ns/activitystreams#Public'],
      };

      const result = updateActivitySchema.safeParse(validActivity);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Update');
        expect(typeof result.data.object).toBe('object');
        if (typeof result.data.object === 'object') {
          expect(result.data.object.id).toBe('https://example.com/events/event-123');
          expect(result.data.object.type).toBe('Event');
        }
      }
    });

    it('should accept Update activity without optional to/cc fields', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/update/123',
        type: 'Update',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-123',
      };

      const result = updateActivitySchema.safeParse(validActivity);
      expect(result.success).toBe(true);
    });

    it('should accept Update activity with published and updated timestamps', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/update/123',
        type: 'Update',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-123',
        published: '2025-02-04T12:00:00Z',
        updated: '2025-02-04T14:30:00Z',
      };

      const result = updateActivitySchema.safeParse(validActivity);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.published).toBe('2025-02-04T12:00:00Z');
        expect(result.data.updated).toBe('2025-02-04T14:30:00Z');
      }
    });

    it('should reject Update activity with wrong type', () => {
      const invalidActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/123',
        type: 'Create', // Wrong type
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-123',
      };

      const result = updateActivitySchema.safeParse(invalidActivity);
      expect(result.success).toBe(false);
    });

    it('should reject Update activity without object field', () => {
      const invalidActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/update/123',
        type: 'Update',
        actor: 'https://example.com/users/alice',
      };

      const result = updateActivitySchema.safeParse(invalidActivity);
      expect(result.success).toBe(false);
    });

    it('should reject Update activity with invalid object URI', () => {
      const invalidActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/update/123',
        type: 'Update',
        actor: 'https://example.com/users/alice',
        object: 'not-a-valid-url',
      };

      const result = updateActivitySchema.safeParse(invalidActivity);
      expect(result.success).toBe(false);
    });

    it('should reject Update activity with embedded object missing required fields', () => {
      const invalidActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/update/123',
        type: 'Update',
        actor: 'https://example.com/users/alice',
        object: {
          // Missing 'type' field
          id: 'https://example.com/events/event-123',
        },
      };

      const result = updateActivitySchema.safeParse(invalidActivity);
      expect(result.success).toBe(false);
    });

    it('should allow additional properties in embedded object', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/update/123',
        type: 'Update',
        actor: 'https://example.com/users/alice',
        object: {
          id: 'https://example.com/events/event-123',
          type: 'Event',
          name: 'Event Name',
          customField: 'custom value',
          anotherCustomField: { nested: 'data' },
        },
      };

      const result = updateActivitySchema.safeParse(validActivity);
      expect(result.success).toBe(true);
    });
  });

  describe('deleteActivitySchema', () => {
    it('should accept a valid Delete activity with URI object', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/delete/123',
        type: 'Delete',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-123',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
      };

      const result = deleteActivitySchema.safeParse(validActivity);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Delete');
        expect(result.data.object).toBe('https://example.com/events/event-123');
      }
    });

    it('should accept a valid Delete activity with embedded tombstone object', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/delete/123',
        type: 'Delete',
        actor: 'https://example.com/users/alice',
        object: {
          id: 'https://example.com/events/event-123',
          type: 'Tombstone',
          formerType: 'Event',
          deleted: '2025-02-04T12:00:00Z',
        },
        to: ['https://www.w3.org/ns/activitystreams#Public'],
      };

      const result = deleteActivitySchema.safeParse(validActivity);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Delete');
        expect(typeof result.data.object).toBe('object');
        if (typeof result.data.object === 'object') {
          expect(result.data.object.type).toBe('Tombstone');
        }
      }
    });

    it('should accept Delete activity without optional to/cc fields', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/delete/123',
        type: 'Delete',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-123',
      };

      const result = deleteActivitySchema.safeParse(validActivity);
      expect(result.success).toBe(true);
    });

    it('should accept Delete activity with published timestamp', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/delete/123',
        type: 'Delete',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-123',
        published: '2025-02-04T12:00:00Z',
      };

      const result = deleteActivitySchema.safeParse(validActivity);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.published).toBe('2025-02-04T12:00:00Z');
      }
    });

    it('should accept Delete activity with multiple recipients', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/delete/123',
        type: 'Delete',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-123',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [
          'https://example.com/users/alice/followers',
          'https://example.com/users/bob',
        ],
      };

      const result = deleteActivitySchema.safeParse(validActivity);
      expect(result.success).toBe(true);
    });

    it('should reject Delete activity with wrong type', () => {
      const invalidActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/123',
        type: 'Update', // Wrong type
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/events/event-123',
      };

      const result = deleteActivitySchema.safeParse(invalidActivity);
      expect(result.success).toBe(false);
    });

    it('should reject Delete activity without object field', () => {
      const invalidActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/delete/123',
        type: 'Delete',
        actor: 'https://example.com/users/alice',
      };

      const result = deleteActivitySchema.safeParse(invalidActivity);
      expect(result.success).toBe(false);
    });

    it('should reject Delete activity with invalid object URI', () => {
      const invalidActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/delete/123',
        type: 'Delete',
        actor: 'https://example.com/users/alice',
        object: 'not-a-valid-url',
      };

      const result = deleteActivitySchema.safeParse(invalidActivity);
      expect(result.success).toBe(false);
    });

    it('should reject Delete activity without required base fields', () => {
      const invalidActivities = [
        // Missing actor
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://example.com/activities/delete/123',
          type: 'Delete',
          object: 'https://example.com/events/event-123',
        },
        // Missing id
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Delete',
          actor: 'https://example.com/users/alice',
          object: 'https://example.com/events/event-123',
        },
        // Missing @context
        {
          id: 'https://example.com/activities/delete/123',
          type: 'Delete',
          actor: 'https://example.com/users/alice',
          object: 'https://example.com/events/event-123',
        },
      ];

      for (const activity of invalidActivities) {
        const result = deleteActivitySchema.safeParse(activity);
        expect(result.success).toBe(false);
      }
    });

    it('should accept Delete activity with embedded object with additional properties', () => {
      const validActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/delete/123',
        type: 'Delete',
        actor: 'https://example.com/users/alice',
        object: {
          id: 'https://example.com/events/event-123',
          type: 'Tombstone',
          formerType: 'Event',
          deleted: '2025-02-04T12:00:00Z',
          customProperty: 'value',
        },
      };

      const result = deleteActivitySchema.safeParse(validActivity);
      expect(result.success).toBe(true);
    });
  });

  describe('announceActivitySchema', () => {
    it('should accept a valid Announce activity with URI object', () => {
      const validAnnounce = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/announce/123',
        type: 'Announce',
        actor: 'https://example.com/calendars/events',
        object: 'https://remote.example/events/event-456',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: ['https://example.com/calendars/events/followers'],
      };

      const result = announceActivitySchema.safeParse(validAnnounce);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Announce');
        expect(result.data.actor).toBe('https://example.com/calendars/events');
        expect(result.data.object).toBe('https://remote.example/events/event-456');
      }
    });

    it('should accept a valid Announce activity with embedded object', () => {
      const validAnnounce = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/announce/789',
        type: 'Announce',
        actor: 'https://example.com/calendars/community',
        object: {
          id: 'https://remote.example/events/event-101',
          type: 'Event',
          name: 'Community Meetup',
          startTime: '2025-03-01T18:00:00Z',
        },
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        published: '2025-02-04T12:00:00Z',
      };

      const result = announceActivitySchema.safeParse(validAnnounce);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Announce');
        expect(typeof result.data.object).toBe('object');
        if (typeof result.data.object === 'object') {
          expect(result.data.object.id).toBe('https://remote.example/events/event-101');
          expect(result.data.object.type).toBe('Event');
        }
      }
    });

    it('should accept Announce activity with embedded Create activity', () => {
      const validAnnounce = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/announce/202',
        type: 'Announce',
        actor: 'https://example.com/calendars/events',
        object: {
          id: 'https://remote.example/activities/create/303',
          type: 'Create',
          actor: 'https://remote.example/users/bob',
          object: {
            id: 'https://remote.example/events/event-404',
            type: 'Event',
          },
        },
        to: ['https://www.w3.org/ns/activitystreams#Public'],
      };

      const result = announceActivitySchema.safeParse(validAnnounce);
      expect(result.success).toBe(true);
    });

    it('should accept Announce activity without optional recipient fields', () => {
      const validAnnounce = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/announce/505',
        type: 'Announce',
        actor: 'https://example.com/calendars/events',
        object: 'https://remote.example/events/event-606',
      };

      const result = announceActivitySchema.safeParse(validAnnounce);
      expect(result.success).toBe(true);
    });

    it('should accept Announce activity with published timestamp', () => {
      const validAnnounce = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/announce/707',
        type: 'Announce',
        actor: 'https://example.com/calendars/events',
        object: 'https://remote.example/events/event-808',
        published: '2025-02-04T15:30:00Z',
      };

      const result = announceActivitySchema.safeParse(validAnnounce);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.published).toBe('2025-02-04T15:30:00Z');
      }
    });

    it('should accept Announce activity with array context', () => {
      const validAnnounce = {
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://w3id.org/security/v1',
        ],
        id: 'https://example.com/activities/announce/909',
        type: 'Announce',
        actor: 'https://example.com/calendars/events',
        object: 'https://remote.example/events/event-1010',
      };

      const result = announceActivitySchema.safeParse(validAnnounce);
      expect(result.success).toBe(true);
    });

    it('should accept Announce activity with multiple recipients', () => {
      const validAnnounce = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/announce/1111',
        type: 'Announce',
        actor: 'https://example.com/calendars/events',
        object: 'https://remote.example/events/event-1212',
        to: [
          'https://www.w3.org/ns/activitystreams#Public',
          'https://example.com/users/alice',
        ],
        cc: [
          'https://example.com/calendars/events/followers',
          'https://example.com/groups/local-events',
        ],
      };

      const result = announceActivitySchema.safeParse(validAnnounce);
      expect(result.success).toBe(true);
    });

    it('should accept HTTP URLs in test environment', () => {
      const validAnnounce = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'http://localhost:3000/activities/announce/1313',
        type: 'Announce',
        actor: 'http://localhost:3000/calendars/test',
        object: 'http://localhost:3000/events/test-event',
      };

      const result = announceActivitySchema.safeParse(validAnnounce);
      expect(result.success).toBe(true);
    });

    it('should reject Announce activity with wrong type', () => {
      const invalidAnnounce = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/announce/1414',
        type: 'Create', // Wrong type
        actor: 'https://example.com/calendars/events',
        object: 'https://remote.example/events/event-1515',
      };

      const result = announceActivitySchema.safeParse(invalidAnnounce);
      expect(result.success).toBe(false);
    });

    it('should reject Announce activity without object field', () => {
      const invalidAnnounce = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/announce/1616',
        type: 'Announce',
        actor: 'https://example.com/calendars/events',
      };

      const result = announceActivitySchema.safeParse(invalidAnnounce);
      expect(result.success).toBe(false);
    });

    it('should reject Announce activity without required base fields', () => {
      const invalidActivities = [
        // Missing actor
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://example.com/activities/announce/1717',
          type: 'Announce',
          object: 'https://remote.example/events/event-1818',
        },
        // Missing id
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Announce',
          actor: 'https://example.com/calendars/events',
          object: 'https://remote.example/events/event-1919',
        },
        // Missing @context
        {
          id: 'https://example.com/activities/announce/2020',
          type: 'Announce',
          actor: 'https://example.com/calendars/events',
          object: 'https://remote.example/events/event-2121',
        },
      ];

      for (const activity of invalidActivities) {
        const result = announceActivitySchema.safeParse(activity);
        expect(result.success).toBe(false);
      }
    });

    it('should reject Announce activity with invalid object URI', () => {
      const invalidAnnounce = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/announce/2222',
        type: 'Announce',
        actor: 'https://example.com/calendars/events',
        object: 'not-a-valid-url',
      };

      const result = announceActivitySchema.safeParse(invalidAnnounce);
      expect(result.success).toBe(false);
    });

    it('should reject Announce activity with embedded object missing required fields', () => {
      const invalidAnnounce = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/announce/2323',
        type: 'Announce',
        actor: 'https://example.com/calendars/events',
        object: {
          // Missing both id and type
          name: 'Some Event',
        },
      };

      const result = announceActivitySchema.safeParse(invalidAnnounce);
      expect(result.success).toBe(false);
    });

    it('should accept Announce activity with embedded object with additional properties', () => {
      const validAnnounce = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/announce/2424',
        type: 'Announce',
        actor: 'https://example.com/calendars/events',
        object: {
          id: 'https://remote.example/events/event-2525',
          type: 'Event',
          name: 'Conference',
          customField: 'custom value',
          location: { name: 'City Hall' },
        },
      };

      const result = announceActivitySchema.safeParse(validAnnounce);
      expect(result.success).toBe(true);
    });
  });

  describe('undoActivitySchema', () => {
    it('should accept a valid Undo activity with URI object', () => {
      const validUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/123',
        type: 'Undo',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/activities/follow/456',
        to: ['https://remote.example/calendars/events'],
      };

      const result = undoActivitySchema.safeParse(validUndo);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Undo');
        expect(result.data.actor).toBe('https://example.com/users/alice');
        expect(result.data.object).toBe('https://example.com/activities/follow/456');
      }
    });

    it('should accept a valid Undo activity with embedded Follow object', () => {
      const validUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/789',
        type: 'Undo',
        actor: 'https://example.com/users/alice',
        object: {
          id: 'https://example.com/activities/follow/101',
          type: 'Follow',
          actor: 'https://example.com/users/alice',
          object: 'https://remote.example/calendars/events',
        },
        to: ['https://remote.example/calendars/events'],
      };

      const result = undoActivitySchema.safeParse(validUndo);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('Undo');
        expect(typeof result.data.object).toBe('object');
        if (typeof result.data.object === 'object') {
          expect(result.data.object.id).toBe('https://example.com/activities/follow/101');
          expect(result.data.object.type).toBe('Follow');
        }
      }
    });

    it('should accept Undo activity undoing an Announce', () => {
      const validUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/202',
        type: 'Undo',
        actor: 'https://example.com/calendars/events',
        object: {
          id: 'https://example.com/activities/announce/303',
          type: 'Announce',
          actor: 'https://example.com/calendars/events',
          object: 'https://remote.example/events/event-404',
        },
        to: ['https://www.w3.org/ns/activitystreams#Public'],
      };

      const result = undoActivitySchema.safeParse(validUndo);
      expect(result.success).toBe(true);
    });

    it('should accept Undo activity undoing a Like', () => {
      const validUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/505',
        type: 'Undo',
        actor: 'https://example.com/users/bob',
        object: {
          id: 'https://example.com/activities/like/606',
          type: 'Like',
          actor: 'https://example.com/users/bob',
          object: 'https://remote.example/events/event-707',
        },
      };

      const result = undoActivitySchema.safeParse(validUndo);
      expect(result.success).toBe(true);
    });

    it('should accept Undo activity undoing a Block', () => {
      const validUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/808',
        type: 'Undo',
        actor: 'https://example.com/calendars/events',
        object: {
          id: 'https://example.com/activities/block/909',
          type: 'Block',
          actor: 'https://example.com/calendars/events',
          object: 'https://spam.example/users/spammer',
        },
      };

      const result = undoActivitySchema.safeParse(validUndo);
      expect(result.success).toBe(true);
    });

    it('should accept Undo activity without optional recipient fields', () => {
      const validUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/1010',
        type: 'Undo',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/activities/follow/1111',
      };

      const result = undoActivitySchema.safeParse(validUndo);
      expect(result.success).toBe(true);
    });

    it('should accept Undo activity with published timestamp', () => {
      const validUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/1212',
        type: 'Undo',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/activities/follow/1313',
        published: '2025-02-04T16:45:00Z',
      };

      const result = undoActivitySchema.safeParse(validUndo);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.published).toBe('2025-02-04T16:45:00Z');
      }
    });

    it('should accept Undo activity with array context', () => {
      const validUndo = {
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://w3id.org/security/v1',
        ],
        id: 'https://example.com/activities/undo/1414',
        type: 'Undo',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/activities/follow/1515',
      };

      const result = undoActivitySchema.safeParse(validUndo);
      expect(result.success).toBe(true);
    });

    it('should accept Undo activity with multiple recipients', () => {
      const validUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/1616',
        type: 'Undo',
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/activities/follow/1717',
        to: [
          'https://remote.example/calendars/events',
          'https://www.w3.org/ns/activitystreams#Public',
        ],
        cc: ['https://example.com/users/alice/followers'],
      };

      const result = undoActivitySchema.safeParse(validUndo);
      expect(result.success).toBe(true);
    });

    it('should accept Undo activity with complex embedded activity', () => {
      const validUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/1818',
        type: 'Undo',
        actor: 'https://example.com/users/charlie',
        object: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://example.com/activities/follow/1919',
          type: 'Follow',
          actor: 'https://example.com/users/charlie',
          object: 'https://remote.example/calendars/community',
          published: '2025-02-03T10:00:00Z',
          to: ['https://remote.example/calendars/community'],
        },
        published: '2025-02-04T17:00:00Z',
      };

      const result = undoActivitySchema.safeParse(validUndo);
      expect(result.success).toBe(true);
    });

    it('should accept HTTP URLs in test environment', () => {
      const validUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'http://localhost:3000/activities/undo/2020',
        type: 'Undo',
        actor: 'http://localhost:3000/users/testuser',
        object: 'http://localhost:3000/activities/follow/2121',
      };

      const result = undoActivitySchema.safeParse(validUndo);
      expect(result.success).toBe(true);
    });

    it('should reject Undo activity with wrong type', () => {
      const invalidUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/2222',
        type: 'Delete', // Wrong type
        actor: 'https://example.com/users/alice',
        object: 'https://example.com/activities/follow/2323',
      };

      const result = undoActivitySchema.safeParse(invalidUndo);
      expect(result.success).toBe(false);
    });

    it('should reject Undo activity without object field', () => {
      const invalidUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/2424',
        type: 'Undo',
        actor: 'https://example.com/users/alice',
      };

      const result = undoActivitySchema.safeParse(invalidUndo);
      expect(result.success).toBe(false);
    });

    it('should reject Undo activity without required base fields', () => {
      const invalidActivities = [
        // Missing actor
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://example.com/activities/undo/2525',
          type: 'Undo',
          object: 'https://example.com/activities/follow/2626',
        },
        // Missing id
        {
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Undo',
          actor: 'https://example.com/users/alice',
          object: 'https://example.com/activities/follow/2727',
        },
        // Missing @context
        {
          id: 'https://example.com/activities/undo/2828',
          type: 'Undo',
          actor: 'https://example.com/users/alice',
          object: 'https://example.com/activities/follow/2929',
        },
      ];

      for (const activity of invalidActivities) {
        const result = undoActivitySchema.safeParse(activity);
        expect(result.success).toBe(false);
      }
    });

    it('should reject Undo activity with invalid object URI', () => {
      const invalidUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/3030',
        type: 'Undo',
        actor: 'https://example.com/users/alice',
        object: 'not-a-valid-url',
      };

      const result = undoActivitySchema.safeParse(invalidUndo);
      expect(result.success).toBe(false);
    });

    it('should reject Undo activity with embedded object missing required fields', () => {
      const invalidUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/3131',
        type: 'Undo',
        actor: 'https://example.com/users/alice',
        object: {
          // Missing both id and type
          actor: 'https://example.com/users/alice',
        },
      };

      const result = undoActivitySchema.safeParse(invalidUndo);
      expect(result.success).toBe(false);
    });

    it('should accept Undo activity with embedded object missing id (schema allows optional id)', () => {
      const validUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/3232',
        type: 'Undo',
        actor: 'https://example.com/users/alice',
        object: {
          type: 'Follow',
          actor: 'https://example.com/users/alice',
          object: 'https://remote.example/calendars/events',
          // id is optional in schema (though typically present for Undo activities)
        },
      };

      const result = undoActivitySchema.safeParse(validUndo);
      expect(result.success).toBe(true);
    });

    it('should reject Undo activity with embedded object missing type', () => {
      const invalidUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/3333',
        type: 'Undo',
        actor: 'https://example.com/users/alice',
        object: {
          id: 'https://example.com/activities/follow/3434',
          actor: 'https://example.com/users/alice',
          object: 'https://remote.example/calendars/events',
        },
      };

      const result = undoActivitySchema.safeParse(invalidUndo);
      expect(result.success).toBe(false);
    });

    it('should accept Undo activity with embedded object with additional properties', () => {
      const validUndo = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/activities/undo/3535',
        type: 'Undo',
        actor: 'https://example.com/users/alice',
        object: {
          id: 'https://example.com/activities/follow/3636',
          type: 'Follow',
          actor: 'https://example.com/users/alice',
          object: 'https://remote.example/calendars/events',
          customField: 'custom value',
          metadata: { reason: 'no longer interested' },
        },
      };

      const result = undoActivitySchema.safeParse(validUndo);
      expect(result.success).toBe(true);
    });
  });
});
