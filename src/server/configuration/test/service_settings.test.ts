// filepath: /Users/stephen/dev/pavillion/src/server/configuration/test/service_settings.test.ts
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
        { parameter: 'registrationMode', value: 'open' },
        { parameter: 'siteTitle', value: 'Test Site' },
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
        { parameter: 'registrationMode', value: 'invite' },
      ]);

      const settings = await ServiceSettings.getInstance();

      expect(settings.get('registrationMode')).toBe('invite');
    });

    it('should return undefined for a non-existent key', async () => {
      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

      const settings = await ServiceSettings.getInstance();

      expect(settings.get('nonExistentKey')).toBeUndefined();
    });
  });

  describe('setRegistrationMode', () => {
    it('should update an existing registration mode setting', async () => {
      const mockRegSettingEntity = { value: 'open', save: sandbox.stub().resolves() };
      const findOrCreateStub = sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
        mockRegSettingEntity as unknown as ServiceSettingEntity, // Return a mock entity with a save method
        false, // Not created, indicates entity existed
      ]);

      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

      const settings = await ServiceSettings.getInstance();
      const result = await settings.setRegistrationMode('open');

      expect(result).toBe(true);
      expect(settings.get('registrationMode')).toBe('open');
      expect(findOrCreateStub.calledOnce).toBe(true);
      expect(mockRegSettingEntity.save.calledOnce).toBe(true);
    });

    it('should create a new registration mode setting if none exists', async () => {
      const findOrCreateStub = sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
        { value: 'invite' }, // Return a mock entity
        true, // Created, indicates entity did not exist before
      ]);

      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

      const settings = await ServiceSettings.getInstance();
      const result = await settings.setRegistrationMode('invite');

      expect(result).toBe(true);
      expect(findOrCreateStub.calledOnce).toBe(true);
    });

    it('should reject invalid registration mode values', async () => {
      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

      const settings = await ServiceSettings.getInstance();

      // Using type assertion to bypass TypeScript's type checking
      // since we're deliberately testing an invalid input
      const result = await settings.setRegistrationMode('invalid' as any);

      expect(result).toBe(false);
      expect(settings.get('registrationMode')).toBe('closed');
    });

    it('change should be reflected in all instances', async () => {
      const findOrCreateStub = sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
        { value: 'apply', save: sandbox.stub().resolves() },
        false,
      ]);

      sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

      const settings = await ServiceSettings.getInstance();
      const instanceBeforeUpdate = await ServiceSettings.getInstance();

      await settings.setRegistrationMode('apply');

      const instanceAfterUpdate = await ServiceSettings.getInstance();

      expect(settings.get('registrationMode')).toBe('apply');
      expect(instanceBeforeUpdate.get('registrationMode')).toBe('apply');
      expect(instanceAfterUpdate.get('registrationMode')).toBe('apply');
    });
  });
});
