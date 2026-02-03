import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import RemoteCalendarService from '@/server/activitypub/service/remote_calendar';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';

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
        actor_type: 'remote',
        calendar_id: null,
        actor_uri: actorUri,
        remote_display_name: 'Remote Events',
        remote_domain: 'remote.example',
        inbox_url: 'https://remote.example/calendars/events/inbox',
        shared_inbox_url: null,
        public_key: '-----BEGIN PUBLIC KEY-----\nKEY\n-----END PUBLIC KEY-----',
        private_key: null,
        last_fetched: new Date('2025-01-15'),
        createdAt: new Date(),
        updatedAt: new Date(),
        toModel: function() {
          return {
            id: this.id,
            actorType: this.actor_type,
            calendarId: this.calendar_id,
            actorUri: this.actor_uri,
            remoteDisplayName: this.remote_display_name,
            remoteDomain: this.remote_domain,
            inboxUrl: this.inbox_url,
            sharedInboxUrl: this.shared_inbox_url,
            publicKey: this.public_key,
            privateKey: this.private_key,
            lastFetched: this.last_fetched,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
          };
        },
      };

      sandbox.stub(CalendarActorEntity, 'findOne').resolves(mockEntity as any);

      const result = await service.getByActorUri(actorUri);

      expect(result).toBeDefined();
      expect(result?.actorUri).toBe(actorUri);
      expect(result?.remoteDisplayName).toBe('Remote Events');
      expect(result?.inboxUrl).toBe('https://remote.example/calendars/events/inbox');
    });

    it('should return null when not found', async () => {
      sandbox.stub(CalendarActorEntity, 'findOne').resolves(null);

      const result = await service.getByActorUri('https://nonexistent.example/calendars/test');

      expect(result).toBeNull();
    });
  });

  describe('getById', () => {
    it('should return remote calendar when found by UUID', async () => {
      const id = 'remote-id-456';
      const mockEntity = {
        id,
        actor_type: 'remote',
        calendar_id: null,
        actor_uri: 'https://remote.example/calendars/community',
        remote_display_name: 'Community Calendar',
        remote_domain: 'remote.example',
        inbox_url: 'https://remote.example/calendars/community/inbox',
        shared_inbox_url: 'https://remote.example/inbox',
        public_key: null,
        private_key: null,
        last_fetched: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        toModel: function() {
          return {
            id: this.id,
            actorType: this.actor_type,
            calendarId: this.calendar_id,
            actorUri: this.actor_uri,
            remoteDisplayName: this.remote_display_name,
            remoteDomain: this.remote_domain,
            inboxUrl: this.inbox_url,
            sharedInboxUrl: this.shared_inbox_url,
            publicKey: this.public_key,
            privateKey: this.private_key,
            lastFetched: this.last_fetched,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
          };
        },
      };

      sandbox.stub(CalendarActorEntity, 'findOne').resolves(mockEntity as any);

      const result = await service.getById(id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(id);
      expect(result?.actorUri).toBe('https://remote.example/calendars/community');
    });

    it('should return null when not found by UUID', async () => {
      sandbox.stub(CalendarActorEntity, 'findOne').resolves(null);

      const result = await service.getById('nonexistent-uuid');

      expect(result).toBeNull();
    });
  });

  describe('findOrCreateByActorUri', () => {
    it('should return existing remote calendar if found', async () => {
      const actorUri = 'https://existing.example/calendars/events';
      const mockEntity = {
        id: 'existing-id',
        actor_type: 'remote',
        calendar_id: null,
        actor_uri: actorUri,
        remote_display_name: 'Existing Calendar',
        remote_domain: 'existing.example',
        inbox_url: 'https://existing.example/calendars/events/inbox',
        shared_inbox_url: null,
        public_key: null,
        private_key: null,
        last_fetched: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        toModel: function() {
          return {
            id: this.id,
            actorType: this.actor_type,
            calendarId: this.calendar_id,
            actorUri: this.actor_uri,
            remoteDisplayName: this.remote_display_name,
            remoteDomain: this.remote_domain,
            inboxUrl: this.inbox_url,
            sharedInboxUrl: this.shared_inbox_url,
            publicKey: this.public_key,
            privateKey: this.private_key,
            lastFetched: this.last_fetched,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
          };
        },
      };

      sandbox.stub(CalendarActorEntity, 'findOne').resolves(mockEntity as any);
      const createStub = sandbox.stub(CalendarActorEntity, 'create');

      const result = await service.findOrCreateByActorUri(actorUri);

      expect(result.actorUri).toBe(actorUri);
      expect(createStub.called).toBe(false); // Should not create since it exists
    });

    it('should create new remote calendar if not found', async () => {
      const actorUri = 'https://new.example/calendars/events';
      const mockCreatedEntity = {
        id: 'new-id-789',
        actor_type: 'remote',
        calendar_id: null,
        actor_uri: actorUri,
        remote_display_name: null,
        remote_domain: 'new.example',
        inbox_url: null,
        shared_inbox_url: null,
        public_key: null,
        private_key: null,
        last_fetched: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        toModel: function() {
          return {
            id: this.id,
            actorType: this.actor_type,
            calendarId: this.calendar_id,
            actorUri: this.actor_uri,
            remoteDisplayName: this.remote_display_name,
            remoteDomain: this.remote_domain,
            inboxUrl: this.inbox_url,
            sharedInboxUrl: this.shared_inbox_url,
            publicKey: this.public_key,
            privateKey: this.private_key,
            lastFetched: this.last_fetched,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
          };
        },
      };

      sandbox.stub(CalendarActorEntity, 'findOne').resolves(null);
      sandbox.stub(CalendarActorEntity, 'create').resolves(mockCreatedEntity as any);

      const result = await service.findOrCreateByActorUri(actorUri);

      expect(result.actorUri).toBe(actorUri);
      expect(result.remoteDisplayName).toBeNull(); // Minimal creation, no metadata yet
    });
  });

  describe('updateMetadata', () => {
    it('should update metadata and set last_fetched', async () => {
      const actorUri = 'https://remote.example/calendars/events';
      const mockEntity = {
        id: 'remote-id',
        actor_type: 'remote',
        calendar_id: null,
        actor_uri: actorUri,
        remote_display_name: null,
        remote_domain: 'remote.example',
        inbox_url: null,
        shared_inbox_url: null,
        public_key: null,
        private_key: null,
        last_fetched: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        save: sinon.stub().resolves(),
        toModel: function() {
          return {
            id: this.id,
            actorType: this.actor_type,
            calendarId: this.calendar_id,
            actorUri: this.actor_uri,
            remoteDisplayName: this.remote_display_name,
            remoteDomain: this.remote_domain,
            inboxUrl: this.inbox_url,
            sharedInboxUrl: this.shared_inbox_url,
            publicKey: this.public_key,
            privateKey: this.private_key,
            lastFetched: this.last_fetched,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
          };
        },
      };

      sandbox.stub(CalendarActorEntity, 'findOne').resolves(mockEntity as any);

      const result = await service.updateMetadata(actorUri, {
        displayName: 'Updated Name',
        inboxUrl: 'https://remote.example/calendars/events/inbox',
        publicKey: '-----BEGIN PUBLIC KEY-----\nNEW_KEY\n-----END PUBLIC KEY-----',
      });

      expect(result).toBeDefined();
      expect(mockEntity.remote_display_name).toBe('Updated Name');
      expect(mockEntity.inbox_url).toBe('https://remote.example/calendars/events/inbox');
      expect(mockEntity.public_key).toBe('-----BEGIN PUBLIC KEY-----\nNEW_KEY\n-----END PUBLIC KEY-----');
      expect(mockEntity.last_fetched).toBeInstanceOf(Date);
      expect(mockEntity.save.called).toBe(true);
    });

    it('should return null if remote calendar not found', async () => {
      sandbox.stub(CalendarActorEntity, 'findOne').resolves(null);

      const result = await service.updateMetadata('https://nonexistent.example/calendars/test', {
        displayName: 'Test',
      });

      expect(result).toBeNull();
    });

    it('should only update provided fields', async () => {
      const actorUri = 'https://remote.example/calendars/events';
      const mockEntity = {
        id: 'remote-id',
        actor_type: 'remote',
        calendar_id: null,
        actor_uri: actorUri,
        remote_display_name: 'Original Name',
        remote_domain: 'remote.example',
        inbox_url: 'https://remote.example/original/inbox',
        shared_inbox_url: null,
        public_key: 'ORIGINAL_KEY',
        private_key: null,
        last_fetched: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        save: sinon.stub().resolves(),
        toModel: function() {
          return {
            id: this.id,
            actorType: this.actor_type,
            calendarId: this.calendar_id,
            actorUri: this.actor_uri,
            remoteDisplayName: this.remote_display_name,
            remoteDomain: this.remote_domain,
            inboxUrl: this.inbox_url,
            sharedInboxUrl: this.shared_inbox_url,
            publicKey: this.public_key,
            privateKey: this.private_key,
            lastFetched: this.last_fetched,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
          };
        },
      };

      sandbox.stub(CalendarActorEntity, 'findOne').resolves(mockEntity as any);

      // Only update display name
      await service.updateMetadata(actorUri, { displayName: 'New Name' });

      expect(mockEntity.remote_display_name).toBe('New Name');
      expect(mockEntity.inbox_url).toBe('https://remote.example/original/inbox'); // Unchanged
      expect(mockEntity.public_key).toBe('ORIGINAL_KEY'); // Unchanged
    });
  });

  describe('isMetadataStale', () => {
    it('should return true if lastFetched is null', () => {
      const calendarActor = {
        id: 'test-id',
        actorType: 'remote' as const,
        calendarId: null,
        actorUri: 'https://remote.example/calendars/events',
        remoteDisplayName: null,
        remoteDomain: 'remote.example',
        inboxUrl: null,
        sharedInboxUrl: null,
        publicKey: null,
        privateKey: null,
        lastFetched: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(service.isMetadataStale(calendarActor)).toBe(true);
    });

    it('should return true if metadata is older than maxAge', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const calendarActor = {
        id: 'test-id',
        actorType: 'remote' as const,
        calendarId: null,
        actorUri: 'https://remote.example/calendars/events',
        remoteDisplayName: 'Test',
        remoteDomain: 'remote.example',
        inboxUrl: null,
        sharedInboxUrl: null,
        publicKey: null,
        privateKey: null,
        lastFetched: twoHoursAgo,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Default maxAge is 1 hour
      expect(service.isMetadataStale(calendarActor)).toBe(true);
    });

    it('should return false if metadata is fresh', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const calendarActor = {
        id: 'test-id',
        actorType: 'remote' as const,
        calendarId: null,
        actorUri: 'https://remote.example/calendars/events',
        remoteDisplayName: 'Test',
        remoteDomain: 'remote.example',
        inboxUrl: null,
        sharedInboxUrl: null,
        publicKey: null,
        privateKey: null,
        lastFetched: fiveMinutesAgo,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Default maxAge is 1 hour, 5 minutes ago is fresh
      expect(service.isMetadataStale(calendarActor)).toBe(false);
    });

    it('should respect custom maxAge parameter', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const calendarActor = {
        id: 'test-id',
        actorType: 'remote' as const,
        calendarId: null,
        actorUri: 'https://remote.example/calendars/events',
        remoteDisplayName: 'Test',
        remoteDomain: 'remote.example',
        inboxUrl: null,
        sharedInboxUrl: null,
        publicKey: null,
        privateKey: null,
        lastFetched: fiveMinutesAgo,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // With 1 minute maxAge, 5 minutes ago is stale
      expect(service.isMetadataStale(calendarActor, 60000)).toBe(true);
    });
  });

  describe('deleteByActorUri', () => {
    it('should return true when deletion successful', async () => {
      sandbox.stub(CalendarActorEntity, 'destroy').resolves(1);

      const result = await service.deleteByActorUri('https://remote.example/calendars/events');

      expect(result).toBe(true);
    });

    it('should return false when nothing to delete', async () => {
      sandbox.stub(CalendarActorEntity, 'destroy').resolves(0);

      const result = await service.deleteByActorUri('https://nonexistent.example/calendars/test');

      expect(result).toBe(false);
    });
  });
});
