import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import RemoteCalendarService from '@/server/activitypub/service/remote_calendar';
import { RemoteCalendarEntity } from '@/server/activitypub/entity/remote_calendar';

describe('RemoteCalendarService', () => {
  let service: RemoteCalendarService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new RemoteCalendarService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getByActorUri', () => {
    it('should return remote calendar when found', async () => {
      const actorUri = 'https://remote.example/calendars/events';
      const mockEntity = {
        id: 'remote-id-123',
        actor_uri: actorUri,
        display_name: 'Remote Events',
        inbox_url: 'https://remote.example/calendars/events/inbox',
        shared_inbox_url: null,
        public_key: '-----BEGIN PUBLIC KEY-----\nKEY\n-----END PUBLIC KEY-----',
        last_fetched: new Date('2025-01-15'),
        createdAt: new Date(),
        updatedAt: new Date(),
        toModel: function() {
          return {
            id: this.id,
            actorUri: this.actor_uri,
            displayName: this.display_name,
            inboxUrl: this.inbox_url,
            sharedInboxUrl: this.shared_inbox_url,
            publicKey: this.public_key,
            lastFetched: this.last_fetched,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
          };
        },
      };

      sandbox.stub(RemoteCalendarEntity, 'findOne').resolves(mockEntity as any);

      const result = await service.getByActorUri(actorUri);

      expect(result).toBeDefined();
      expect(result?.actorUri).toBe(actorUri);
      expect(result?.displayName).toBe('Remote Events');
      expect(result?.inboxUrl).toBe('https://remote.example/calendars/events/inbox');
    });

    it('should return null when not found', async () => {
      sandbox.stub(RemoteCalendarEntity, 'findOne').resolves(null);

      const result = await service.getByActorUri('https://nonexistent.example/calendars/test');

      expect(result).toBeNull();
    });
  });

  describe('getById', () => {
    it('should return remote calendar when found by UUID', async () => {
      const id = 'remote-id-456';
      const mockEntity = {
        id,
        actor_uri: 'https://remote.example/calendars/community',
        display_name: 'Community Calendar',
        inbox_url: 'https://remote.example/calendars/community/inbox',
        shared_inbox_url: 'https://remote.example/inbox',
        public_key: null,
        last_fetched: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        toModel: function() {
          return {
            id: this.id,
            actorUri: this.actor_uri,
            displayName: this.display_name,
            inboxUrl: this.inbox_url,
            sharedInboxUrl: this.shared_inbox_url,
            publicKey: this.public_key,
            lastFetched: this.last_fetched,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
          };
        },
      };

      sandbox.stub(RemoteCalendarEntity, 'findByPk').resolves(mockEntity as any);

      const result = await service.getById(id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(id);
      expect(result?.actorUri).toBe('https://remote.example/calendars/community');
    });

    it('should return null when not found by UUID', async () => {
      sandbox.stub(RemoteCalendarEntity, 'findByPk').resolves(null);

      const result = await service.getById('nonexistent-uuid');

      expect(result).toBeNull();
    });
  });

  describe('findOrCreateByActorUri', () => {
    it('should return existing remote calendar if found', async () => {
      const actorUri = 'https://existing.example/calendars/events';
      const mockEntity = {
        id: 'existing-id',
        actor_uri: actorUri,
        display_name: 'Existing Calendar',
        inbox_url: 'https://existing.example/calendars/events/inbox',
        shared_inbox_url: null,
        public_key: null,
        last_fetched: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        toModel: function() {
          return {
            id: this.id,
            actorUri: this.actor_uri,
            displayName: this.display_name,
            inboxUrl: this.inbox_url,
            sharedInboxUrl: this.shared_inbox_url,
            publicKey: this.public_key,
            lastFetched: this.last_fetched,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
          };
        },
      };

      sandbox.stub(RemoteCalendarEntity, 'findOne').resolves(mockEntity as any);
      const createStub = sandbox.stub(RemoteCalendarEntity, 'create');

      const result = await service.findOrCreateByActorUri(actorUri);

      expect(result.actorUri).toBe(actorUri);
      expect(createStub.called).toBe(false); // Should not create since it exists
    });

    it('should create new remote calendar if not found', async () => {
      const actorUri = 'https://new.example/calendars/events';
      const mockCreatedEntity = {
        id: 'new-id-789',
        actor_uri: actorUri,
        display_name: null,
        inbox_url: null,
        shared_inbox_url: null,
        public_key: null,
        last_fetched: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        toModel: function() {
          return {
            id: this.id,
            actorUri: this.actor_uri,
            displayName: this.display_name,
            inboxUrl: this.inbox_url,
            sharedInboxUrl: this.shared_inbox_url,
            publicKey: this.public_key,
            lastFetched: this.last_fetched,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
          };
        },
      };

      sandbox.stub(RemoteCalendarEntity, 'findOne').resolves(null);
      sandbox.stub(RemoteCalendarEntity, 'create').resolves(mockCreatedEntity as any);

      const result = await service.findOrCreateByActorUri(actorUri);

      expect(result.actorUri).toBe(actorUri);
      expect(result.displayName).toBeNull(); // Minimal creation, no metadata yet
    });
  });

  describe('updateMetadata', () => {
    it('should update metadata and set last_fetched', async () => {
      const actorUri = 'https://remote.example/calendars/events';
      const mockEntity = {
        id: 'remote-id',
        actor_uri: actorUri,
        display_name: null,
        inbox_url: null,
        shared_inbox_url: null,
        public_key: null,
        last_fetched: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        save: sinon.stub().resolves(),
        toModel: function() {
          return {
            id: this.id,
            actorUri: this.actor_uri,
            displayName: this.display_name,
            inboxUrl: this.inbox_url,
            sharedInboxUrl: this.shared_inbox_url,
            publicKey: this.public_key,
            lastFetched: this.last_fetched,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
          };
        },
      };

      sandbox.stub(RemoteCalendarEntity, 'findOne').resolves(mockEntity as any);

      const result = await service.updateMetadata(actorUri, {
        displayName: 'Updated Name',
        inboxUrl: 'https://remote.example/calendars/events/inbox',
        publicKey: '-----BEGIN PUBLIC KEY-----\nNEW_KEY\n-----END PUBLIC KEY-----',
      });

      expect(result).toBeDefined();
      expect(mockEntity.display_name).toBe('Updated Name');
      expect(mockEntity.inbox_url).toBe('https://remote.example/calendars/events/inbox');
      expect(mockEntity.public_key).toBe('-----BEGIN PUBLIC KEY-----\nNEW_KEY\n-----END PUBLIC KEY-----');
      expect(mockEntity.last_fetched).toBeInstanceOf(Date);
      expect(mockEntity.save.called).toBe(true);
    });

    it('should return null if remote calendar not found', async () => {
      sandbox.stub(RemoteCalendarEntity, 'findOne').resolves(null);

      const result = await service.updateMetadata('https://nonexistent.example/calendars/test', {
        displayName: 'Test',
      });

      expect(result).toBeNull();
    });

    it('should only update provided fields', async () => {
      const actorUri = 'https://remote.example/calendars/events';
      const mockEntity = {
        id: 'remote-id',
        actor_uri: actorUri,
        display_name: 'Original Name',
        inbox_url: 'https://remote.example/original/inbox',
        shared_inbox_url: null,
        public_key: 'ORIGINAL_KEY',
        last_fetched: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        save: sinon.stub().resolves(),
        toModel: function() {
          return {
            id: this.id,
            actorUri: this.actor_uri,
            displayName: this.display_name,
            inboxUrl: this.inbox_url,
            sharedInboxUrl: this.shared_inbox_url,
            publicKey: this.public_key,
            lastFetched: this.last_fetched,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
          };
        },
      };

      sandbox.stub(RemoteCalendarEntity, 'findOne').resolves(mockEntity as any);

      // Only update display name
      await service.updateMetadata(actorUri, { displayName: 'New Name' });

      expect(mockEntity.display_name).toBe('New Name');
      expect(mockEntity.inbox_url).toBe('https://remote.example/original/inbox'); // Unchanged
      expect(mockEntity.public_key).toBe('ORIGINAL_KEY'); // Unchanged
    });
  });

  describe('isMetadataStale', () => {
    it('should return true if lastFetched is null', () => {
      const remoteCalendar = {
        id: 'test-id',
        actorUri: 'https://remote.example/calendars/events',
        displayName: null,
        inboxUrl: null,
        sharedInboxUrl: null,
        publicKey: null,
        lastFetched: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(service.isMetadataStale(remoteCalendar)).toBe(true);
    });

    it('should return true if metadata is older than maxAge', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const remoteCalendar = {
        id: 'test-id',
        actorUri: 'https://remote.example/calendars/events',
        displayName: 'Test',
        inboxUrl: null,
        sharedInboxUrl: null,
        publicKey: null,
        lastFetched: twoHoursAgo,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Default maxAge is 1 hour
      expect(service.isMetadataStale(remoteCalendar)).toBe(true);
    });

    it('should return false if metadata is fresh', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const remoteCalendar = {
        id: 'test-id',
        actorUri: 'https://remote.example/calendars/events',
        displayName: 'Test',
        inboxUrl: null,
        sharedInboxUrl: null,
        publicKey: null,
        lastFetched: fiveMinutesAgo,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Default maxAge is 1 hour, 5 minutes ago is fresh
      expect(service.isMetadataStale(remoteCalendar)).toBe(false);
    });

    it('should respect custom maxAge parameter', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const remoteCalendar = {
        id: 'test-id',
        actorUri: 'https://remote.example/calendars/events',
        displayName: 'Test',
        inboxUrl: null,
        sharedInboxUrl: null,
        publicKey: null,
        lastFetched: fiveMinutesAgo,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // With 1 minute maxAge, 5 minutes ago is stale
      expect(service.isMetadataStale(remoteCalendar, 60000)).toBe(true);
    });
  });

  describe('deleteByActorUri', () => {
    it('should return true when deletion successful', async () => {
      sandbox.stub(RemoteCalendarEntity, 'destroy').resolves(1);

      const result = await service.deleteByActorUri('https://remote.example/calendars/events');

      expect(result).toBe(true);
    });

    it('should return false when nothing to delete', async () => {
      sandbox.stub(RemoteCalendarEntity, 'destroy').resolves(0);

      const result = await service.deleteByActorUri('https://nonexistent.example/calendars/test');

      expect(result).toBe(false);
    });
  });
});
