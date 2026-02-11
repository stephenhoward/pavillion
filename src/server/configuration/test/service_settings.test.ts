import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import ServiceSettings from '@/server/configuration/service/settings';
import ServiceSettingEntity from '@/server/configuration/entity/settings';

describe('ServiceSettings', () => {
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    // Reset the ServiceSettings instance before each test
    // This needs explicit assignment since "instance" is private
    Reflect.set(ServiceSettings, 'instance', null);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getInstance', () => {
    it('should create and return a new instance when none exists', async () => {
      const initStub = sandbox.stub(ServiceSettings.prototype, 'init').resolves();

      const instance = await ServiceSettings.getInstance();

      expect(instance).toBeInstanceOf(ServiceSettings);
      expect(initStub.calledOnce).toBe(true);
    });

    it('should return the existing instance without initialization when one exists', async () => {
      const initStub = sandbox.stub(ServiceSettings.prototype, 'init').resolves();

      // First call creates the instance
      const instance1 = await ServiceSettings.getInstance();
      // Second call should return the same instance
      const instance2 = await ServiceSettings.getInstance();

      expect(instance1).toBe(instance2);
      expect(initStub.calledOnce).toBe(true);
    });
  });

  describe('init', () => {
    it('should load settings from the database', async () => {

      const findAllStub = sandbox.stub(ServiceSettingEntity, 'findAll').resolves([
        { parameter: 'registrationMode', value: 'open' } as unknown as ServiceSettingEntity,
        { parameter: 'siteTitle', value: 'Test Site' } as unknown as ServiceSettingEntity,
      ]);

      const settings = await ServiceSettings.getInstance();
      settings.init();

      expect(findAllStub.called).toBe(true);
      expect(settings.get('registrationMode')).toBe('open');
      expect(settings.get('siteTitle')).toBe('Test Site');
    });
  });

  describe('get', () => {
    it('should return the value for an existing key', async () => {

      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([
        { parameter: 'registrationMode', value: 'invitation' } as unknown as ServiceSettingEntity,
      ]);

      const settings = await ServiceSettings.getInstance();

      expect(settings.get('registrationMode')).toBe('invitation');
    });

    it('should return undefined for a non-existent key', async () => {
      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

      const settings = await ServiceSettings.getInstance();

      expect(settings.get('nonExistentKey')).toBeUndefined();
    });
  });

  describe('set', () => {
    it('should update an existing setting', async () => {
      const mockSettingEntity = { parameter: 'registrationMode', value: 'open', save: sandbox.stub().resolves() };
      sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
        mockSettingEntity as unknown as ServiceSettingEntity, // Return a mock entity with a save method
        false, // Not created, indicates entity existed
      ]);

      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

      const settings = await ServiceSettings.getInstance();
      const result = await settings.set('registrationMode', 'open');

      expect(result).toBe(true);
      expect(settings.get('registrationMode')).toBe('open');
      expect(mockSettingEntity.save.called).toBe(true);
    });

    it('should create a new setting if none exists', async () => {
      const mockSettingEntity = { parameter: 'registrationMode', value: 'invitation', save: sandbox.stub().resolves() };
      sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
        mockSettingEntity as unknown as ServiceSettingEntity, // Return a mock entity with a save method
        true, // Created, indicates entity did not exist before
      ]);

      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

      const settings = await ServiceSettings.getInstance();
      const result = await settings.set('registrationMode', 'open');

      expect(result).toBe(true);
      expect(settings.get('registrationMode')).toBe('open');
      expect(mockSettingEntity.save.called).toBe(false);
    });

    it('should update the site title', async () => {
      const mockSettingEntity = { parameter: 'siteTitle', value: 'My Site', save: sandbox.stub().resolves() };
      sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
        mockSettingEntity as unknown as ServiceSettingEntity,
        false,
      ]);

      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([ mockSettingEntity as unknown as ServiceSettingEntity ]);

      const settings = await ServiceSettings.getInstance();
      const result = await settings.set('siteTitle', 'My New Site');

      expect(result).toBe(true);
      expect(settings.get('siteTitle')).toBe('My New Site');
      expect(mockSettingEntity.save.calledOnce).toBe(true);
    });

    it('should reject invalid registration mode values', async () => {
      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

      const settings = await ServiceSettings.getInstance();

      // Using type assertion to bypass TypeScript's type checking
      // since we're deliberately testing an invalid input
      const result = await settings.set('registrationMode', 'invalid');

      expect(result).toBe(false);
      expect(settings.get('registrationMode')).toBe('invitation'); // Default value
    });

    it('should persist extension parameters not in the typed Config', async () => {
      const mockSettingEntity = { parameter: 'moderation.autoEscalationHours', value: '48', save: sandbox.stub().resolves() };
      sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
        mockSettingEntity as unknown as ServiceSettingEntity,
        true, // Created
      ]);
      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

      const settings = await ServiceSettings.getInstance();
      const result = await settings.set('moderation.autoEscalationHours', '48');

      expect(result).toBe(true);
    });

    it('should update existing extension parameters', async () => {
      const mockSettingEntity = { parameter: 'moderation.autoEscalationHours', value: '72', save: sandbox.stub().resolves() };
      sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
        mockSettingEntity as unknown as ServiceSettingEntity,
        false, // Not created, already exists
      ]);
      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

      const settings = await ServiceSettings.getInstance();
      const result = await settings.set('moderation.autoEscalationHours', '48');

      expect(result).toBe(true);
      expect(mockSettingEntity.save.calledOnce).toBe(true);
    });

    it('should update the default date range', async () => {
      const mockSettingEntity = { parameter: 'defaultDateRange', value: '2weeks', save: sandbox.stub().resolves() };
      sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
        mockSettingEntity as unknown as ServiceSettingEntity,
        false,
      ]);

      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

      const settings = await ServiceSettings.getInstance();
      const result = await settings.set('defaultDateRange', '1month');

      expect(result).toBe(true);
      expect(settings.get('defaultDateRange')).toBe('1month');
      expect(mockSettingEntity.save.calledOnce).toBe(true);
    });

    it('should reject invalid default date range values', async () => {
      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

      const settings = await ServiceSettings.getInstance();
      const result = await settings.set('defaultDateRange', 'invalid');

      expect(result).toBe(false);
      expect(settings.get('defaultDateRange')).toBe('2weeks');
    });

    it('change should be reflected in all instances', async () => {
      sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
        { parameter: 'registrationMode', value: 'invitation', save: sandbox.stub().resolves() } as unknown as ServiceSettingEntity,
        false,
      ]);

      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

      const settings = await ServiceSettings.getInstance();
      const instanceBeforeUpdate = await ServiceSettings.getInstance();

      await settings.set('registrationMode', 'apply');

      const instanceAfterUpdate = await ServiceSettings.getInstance();

      expect(settings.get('registrationMode')).toBe('apply');
      expect(instanceBeforeUpdate.get('registrationMode')).toBe('apply');
      expect(instanceAfterUpdate.get('registrationMode')).toBe('apply');
    });

    describe('moderation.autoEscalationThreshold', () => {
      it('should persist moderation.autoEscalationThreshold with valid positive integer', async () => {
        const mockSettingEntity = { parameter: 'moderation.autoEscalationThreshold', value: '5', save: sandbox.stub().resolves() };
        sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
          mockSettingEntity as unknown as ServiceSettingEntity,
          true,
        ]);
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.autoEscalationThreshold', 5);

        expect(result).toBe(true);
      });

      it('should persist moderation.autoEscalationThreshold with zero to disable auto-escalation', async () => {
        const mockSettingEntity = { parameter: 'moderation.autoEscalationThreshold', value: '0', save: sandbox.stub().resolves() };
        sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
          mockSettingEntity as unknown as ServiceSettingEntity,
          true,
        ]);
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.autoEscalationThreshold', 0);

        expect(result).toBe(true);
      });

      it('should update existing moderation.autoEscalationThreshold', async () => {
        const mockSettingEntity = { parameter: 'moderation.autoEscalationThreshold', value: '10', save: sandbox.stub().resolves() };
        sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
          mockSettingEntity as unknown as ServiceSettingEntity,
          false,
        ]);
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.autoEscalationThreshold', 5);

        expect(result).toBe(true);
        expect(mockSettingEntity.save.calledOnce).toBe(true);
      });

      it('should reject negative values for moderation.autoEscalationThreshold', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.autoEscalationThreshold', -5);

        expect(result).toBe(false);
      });

      it('should reject non-integer values for moderation.autoEscalationThreshold', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.autoEscalationThreshold', 5.5);

        expect(result).toBe(false);
      });

      it('should reject string values for moderation.autoEscalationThreshold', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.autoEscalationThreshold', 'invalid');

        expect(result).toBe(false);
      });
    });

    describe('moderation.ipHashRetentionDays', () => {
      it('should persist moderation.ipHashRetentionDays with valid positive integer', async () => {
        const mockSettingEntity = { parameter: 'moderation.ipHashRetentionDays', value: '30', save: sandbox.stub().resolves() };
        sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
          mockSettingEntity as unknown as ServiceSettingEntity,
          true,
        ]);
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.ipHashRetentionDays', 30);

        expect(result).toBe(true);
      });

      it('should update existing moderation.ipHashRetentionDays', async () => {
        const mockSettingEntity = { parameter: 'moderation.ipHashRetentionDays', value: '60', save: sandbox.stub().resolves() };
        sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
          mockSettingEntity as unknown as ServiceSettingEntity,
          false,
        ]);
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.ipHashRetentionDays', 30);

        expect(result).toBe(true);
        expect(mockSettingEntity.save.calledOnce).toBe(true);
      });

      it('should reject zero for moderation.ipHashRetentionDays', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.ipHashRetentionDays', 0);

        expect(result).toBe(false);
      });

      it('should reject negative values for moderation.ipHashRetentionDays', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.ipHashRetentionDays', -5);

        expect(result).toBe(false);
      });

      it('should reject non-integer values for moderation.ipHashRetentionDays', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.ipHashRetentionDays', 5.5);

        expect(result).toBe(false);
      });

      it('should reject string values for moderation.ipHashRetentionDays', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.ipHashRetentionDays', 'invalid');

        expect(result).toBe(false);
      });
    });

    describe('moderation.ipSubnetRetentionDays', () => {
      it('should persist moderation.ipSubnetRetentionDays with valid positive integer', async () => {
        const mockSettingEntity = { parameter: 'moderation.ipSubnetRetentionDays', value: '90', save: sandbox.stub().resolves() };
        sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
          mockSettingEntity as unknown as ServiceSettingEntity,
          true,
        ]);
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.ipSubnetRetentionDays', 90);

        expect(result).toBe(true);
      });

      it('should update existing moderation.ipSubnetRetentionDays', async () => {
        const mockSettingEntity = { parameter: 'moderation.ipSubnetRetentionDays', value: '120', save: sandbox.stub().resolves() };
        sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
          mockSettingEntity as unknown as ServiceSettingEntity,
          false,
        ]);
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.ipSubnetRetentionDays', 90);

        expect(result).toBe(true);
        expect(mockSettingEntity.save.calledOnce).toBe(true);
      });

      it('should reject zero for moderation.ipSubnetRetentionDays', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.ipSubnetRetentionDays', 0);

        expect(result).toBe(false);
      });

      it('should reject negative values for moderation.ipSubnetRetentionDays', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.ipSubnetRetentionDays', -5);

        expect(result).toBe(false);
      });

      it('should reject non-integer values for moderation.ipSubnetRetentionDays', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.ipSubnetRetentionDays', 5.5);

        expect(result).toBe(false);
      });

      it('should reject string values for moderation.ipSubnetRetentionDays', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('moderation.ipSubnetRetentionDays', 'invalid');

        expect(result).toBe(false);
      });
    });
  });
});
