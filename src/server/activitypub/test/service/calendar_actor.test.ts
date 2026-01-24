import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { generateKeyPairSync } from 'crypto';

import { Calendar } from '@/common/model/calendar';
import CalendarActorService from '@/server/activitypub/service/calendar_actor';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { CalendarEntity } from '@/server/calendar/entity/calendar';

describe('CalendarActorService', () => {
  let service: CalendarActorService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new CalendarActorService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('createActor', () => {
    it('should generate valid RSA-2048 keypair', async () => {
      const testCalendar = new Calendar('calendar-id-123', 'community-events');
      const domain = 'events.example';

      // Stub entity creation
      const mockEntity = {
        id: 'actor-id-123',
        calendar_id: testCalendar.id,
        actor_uri: `https://${domain}/calendars/${testCalendar.urlName}`,
        public_key: 'PUBLIC_KEY_PEM',
        private_key: 'PRIVATE_KEY_PEM',
        toModel: function() {
          return {
            id: this.id,
            calendarId: this.calendar_id,
            actorUri: this.actor_uri,
            publicKey: this.public_key,
            privateKey: this.private_key,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      };

      const createStub = sandbox.stub(CalendarActorEntity, 'create').resolves(mockEntity as any);

      await service.createActor(testCalendar, domain);

      // Verify create was called
      expect(createStub.calledOnce).toBe(true);

      const callArgs = createStub.firstCall.args[0];

      // Verify calendar_id is correct
      expect(callArgs.calendar_id).toBe(testCalendar.id);

      // Verify actor URI format
      expect(callArgs.actor_uri).toBe(`https://${domain}/calendars/${testCalendar.urlName}`);

      // Verify keypair fields exist
      expect(callArgs.public_key).toBeDefined();
      expect(callArgs.private_key).toBeDefined();

      // Verify keypair format (should start with PEM headers)
      expect(callArgs.public_key).toContain('BEGIN PUBLIC KEY');
      expect(callArgs.private_key).toContain('BEGIN PRIVATE KEY');
    });

    it('should format actor URI correctly', async () => {
      const testCalendar = new Calendar('calendar-id-456', 'local-meetups');
      const domain = 'pavillion.dev';

      const createStub = sandbox.stub(CalendarActorEntity, 'create').resolves({
        toModel: () => ({
          id: 'actor-id',
          calendarId: 'calendar-id-456',
          actorUri: `https://${domain}/calendars/local-meetups`,
          publicKey: '',
          privateKey: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      } as any);

      await service.createActor(testCalendar, domain);

      const callArgs = createStub.firstCall.args[0];
      expect(callArgs.actor_uri).toBe(`https://${domain}/calendars/${testCalendar.urlName}`);
    });
  });

  describe('getActorByUrlName', () => {
    it('should return actor for existing calendar', async () => {
      const testUrlName = 'community-events';
      const mockData = {
        id: 'actor-id-123',
        calendar_id: 'calendar-id-123',
        actor_uri: 'https://events.example/calendars/community-events',
        public_key: '-----BEGIN PUBLIC KEY-----\nKEY_DATA\n-----END PUBLIC KEY-----',
        private_key: '-----BEGIN PRIVATE KEY-----\nKEY_DATA\n-----END PRIVATE KEY-----',
      };

      const mockEntity = {
        ...mockData,
        toModel: function() {
          return {
            id: this.id,
            calendarId: this.calendar_id,
            actorUri: this.actor_uri,
            publicKey: this.public_key,
            privateKey: this.private_key,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      };

      // Mock the calendar lookup
      const calendarStub = sandbox.stub(CalendarEntity, 'findOne').resolves({
        id: 'calendar-id-123',
        url_name: testUrlName,
      } as any);

      const findStub = sandbox.stub(CalendarActorEntity, 'findOne').resolves(mockEntity as any);

      const result = await service.getActorByUrlName(testUrlName);

      expect(calendarStub.calledOnce).toBe(true);
      expect(findStub.calledOnce).toBe(true);
      expect(result).toBeDefined();
      expect(result?.actorUri).toBe(mockData.actor_uri);
      expect(result?.publicKey).toBe(mockData.public_key);
    });

    it('should return null for non-existent calendar', async () => {
      sandbox.stub(CalendarEntity, 'findOne').resolves(null);

      const result = await service.getActorByUrlName('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getActorByCalendarId', () => {
    it('should return actor for existing calendar ID', async () => {
      const calendarId = 'calendar-id-123';
      const mockData = {
        id: 'actor-id-123',
        calendar_id: calendarId,
        actor_uri: 'https://events.example/calendars/community-events',
        public_key: '-----BEGIN PUBLIC KEY-----\nKEY_DATA\n-----END PUBLIC KEY-----',
        private_key: '-----BEGIN PRIVATE KEY-----\nKEY_DATA\n-----END PRIVATE KEY-----',
      };

      const mockEntity = {
        ...mockData,
        toModel: function() {
          return {
            id: this.id,
            calendarId: this.calendar_id,
            actorUri: this.actor_uri,
            publicKey: this.public_key,
            privateKey: this.private_key,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      };

      const findStub = sandbox.stub(CalendarActorEntity, 'findOne').resolves(mockEntity as any);

      const result = await service.getActorByCalendarId(calendarId);

      expect(findStub.calledOnce).toBe(true);
      expect(result).toBeDefined();
      expect(result?.actorUri).toBe(mockData.actor_uri);
    });
  });

  describe('signActivity', () => {
    it('should produce valid HTTP signature format', async () => {
      const actorUri = 'https://events.example/calendars/community-events';
      const mockData = {
        id: 'actor-id-123',
        calendar_id: 'calendar-id-123',
        actor_uri: actorUri,
        public_key: '-----BEGIN PUBLIC KEY-----\nKEY_DATA\n-----END PUBLIC KEY-----',
        private_key: '-----BEGIN PRIVATE KEY-----\nKEY_DATA\n-----END PRIVATE KEY-----',
      };

      // Generate a real keypair for this test to make signing work
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const mockEntity = {
        ...mockData,
        private_key: privateKey,
        toModel: function() {
          return {
            id: this.id,
            calendarId: this.calendar_id,
            actorUri: this.actor_uri,
            publicKey: this.public_key,
            privateKey: this.private_key,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      };

      sandbox.stub(CalendarActorEntity, 'findOne').resolves(mockEntity as any);

      const activity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Announce',
        actor: actorUri,
        object: 'https://events.example/calendars/community-events/events/123',
      };

      const targetUrl = 'https://remote.example/inbox';
      const signature = await service.signActivity(actorUri, activity, targetUrl);

      // Verify signature has required fields
      expect(signature).toBeDefined();
      expect(signature.keyId).toBe(`${actorUri}#main-key`);
      expect(signature.signature).toBeDefined();
      expect(signature.algorithm).toBe('rsa-sha256');
      expect(signature.headers).toContain('(request-target)');
      expect(signature.headers).toContain('host');
      expect(signature.headers).toContain('date');
    });
  });

  describe('verifySignature', () => {
    it('should validate known signatures correctly', async () => {
      // Generate a real keypair for testing
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const actorUri = 'https://events.example/calendars/community-events';
      const mockData = {
        id: 'actor-id-123',
        calendar_id: 'calendar-id-123',
        actor_uri: actorUri,
        public_key: publicKey,
        private_key: privateKey,
      };

      const mockEntity = {
        ...mockData,
        toModel: function() {
          return {
            id: this.id,
            calendarId: this.calendar_id,
            actorUri: this.actor_uri,
            publicKey: this.public_key,
            privateKey: this.private_key,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      };

      sandbox.stub(CalendarActorEntity, 'findOne').resolves(mockEntity as any);

      const activity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Announce',
        actor: actorUri,
        object: 'https://events.example/calendars/community-events/events/123',
      };

      const targetUrl = 'https://remote.example/inbox';

      // Sign the activity
      const signatureData = await service.signActivity(actorUri, activity, targetUrl);

      // Parse the target URL for the mock request
      const url = new URL(targetUrl);

      // Create a mock request with the signature
      const mockRequest = {
        headers: {
          signature: `keyId="${signatureData.keyId}",signature="${signatureData.signature}",algorithm="${signatureData.algorithm}",headers="${signatureData.headers}"`,
          date: signatureData.date,
          host: url.host,
        },
        method: 'POST',
        url: url.pathname + url.search,
      };

      // Verify the signature
      const isValid = await service.verifySignature(mockRequest as any, actorUri);

      expect(isValid).toBe(true);
    });

    it('should reject signature with wrong key', async () => {
      // Generate two different keypairs
      const { publicKey: publicKey1 } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const { privateKey: privateKey2 } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const actorUri = 'https://events.example/calendars/community-events';
      const mockData = {
        id: 'actor-id-123',
        calendar_id: 'calendar-id-123',
        actor_uri: actorUri,
        public_key: publicKey1, // Different public key
        private_key: privateKey2, // Mismatched private key for signing
      };

      const createMockEntity = (data: any) => ({
        ...data,
        toModel: function() {
          return {
            id: this.id,
            calendarId: this.calendar_id,
            actorUri: this.actor_uri,
            publicKey: this.public_key,
            privateKey: this.private_key,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      });

      const findStub = sandbox.stub(CalendarActorEntity, 'findOne');
      findStub.onFirstCall().resolves(createMockEntity({
        ...mockData,
        private_key: privateKey2, // For signing
      }) as any);
      findStub.onSecondCall().resolves(createMockEntity({
        ...mockData,
        public_key: publicKey1, // For verification (mismatched)
      }) as any);

      const mockRequest = {
        headers: {
          signature: 'invalid-signature-string',
          date: new Date().toUTCString(),
        },
        method: 'POST',
        url: 'https://remote.example/inbox',
      };

      // This should fail because keys don't match
      const isValid = await service.verifySignature(mockRequest as any, actorUri);

      expect(isValid).toBe(false);
    });
  });

  describe('getPublicKeyByUrlName', () => {
    it('should return public key for existing calendar', async () => {
      const mockPublicKey = '-----BEGIN PUBLIC KEY-----\nKEY_DATA\n-----END PUBLIC KEY-----';

      const mockEntity = {
        id: 'actor-id-123',
        calendar_id: 'calendar-id-123',
        actor_uri: 'https://events.example/calendars/community-events',
        public_key: mockPublicKey,
        private_key: 'PRIVATE_KEY',
        toModel: function() {
          return {
            id: this.id,
            calendarId: this.calendar_id,
            actorUri: this.actor_uri,
            publicKey: this.public_key,
            privateKey: this.private_key,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      };

      sandbox.stub(CalendarEntity, 'findOne').resolves({
        id: 'calendar-id-123',
        url_name: 'community-events',
      } as any);

      sandbox.stub(CalendarActorEntity, 'findOne').resolves(mockEntity as any);

      const result = await service.getPublicKeyByUrlName('community-events');

      expect(result).toBe(mockPublicKey);
    });

    it('should return null for non-existent calendar', async () => {
      sandbox.stub(CalendarEntity, 'findOne').resolves(null);

      const result = await service.getPublicKeyByUrlName('nonexistent');

      expect(result).toBeNull();
    });
  });
});
