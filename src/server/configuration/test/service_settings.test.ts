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

    describe('enabledLanguages', () => {
      it('should accept a valid array of language codes as JSON string', async () => {
        const mockSettingEntity = {
          parameter: 'enabledLanguages',
          value: '["en","es"]',
          save: sandbox.stub().resolves(),
        };
        sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
          mockSettingEntity as unknown as ServiceSettingEntity,
          true,
        ]);
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('enabledLanguages', '["en","es"]');

        expect(result).toBe(true);
        expect(settings.getEnabledLanguages()).toEqual(['en', 'es']);
      });

      it('should reject an empty array for enabledLanguages', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('enabledLanguages', '[]');

        expect(result).toBe(false);
      });

      it('should reject invalid language codes in enabledLanguages', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('enabledLanguages', '["en","zz"]');

        expect(result).toBe(false);
      });

      it('should reject invalid JSON for enabledLanguages', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('enabledLanguages', 'not-json');

        expect(result).toBe(false);
      });

      it('should load enabledLanguages from database on init', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([
          { parameter: 'enabledLanguages', value: '["en"]' } as unknown as ServiceSettingEntity,
        ]);

        const settings = await ServiceSettings.getInstance();

        expect(settings.getEnabledLanguages()).toEqual(['en']);
      });

      it('should use default enabled languages when not in database', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();

        // Default should include all languages meeting BETA_THRESHOLD
        expect(settings.getEnabledLanguages().length).toBeGreaterThan(0);
        expect(settings.getEnabledLanguages()).toContain('en');
      });
    });

    describe('forceLanguage', () => {
      it('should accept a valid language code for forceLanguage', async () => {
        const mockSettingEntity = {
          parameter: 'forceLanguage',
          value: 'es',
          save: sandbox.stub().resolves(),
        };
        sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
          mockSettingEntity as unknown as ServiceSettingEntity,
          true,
        ]);
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('forceLanguage', 'es');

        expect(result).toBe(true);
        expect(settings.getForceLanguage()).toBe('es');
      });

      it('should accept empty string to clear forceLanguage', async () => {
        const mockSettingEntity = {
          parameter: 'forceLanguage',
          value: '',
          save: sandbox.stub().resolves(),
        };
        sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
          mockSettingEntity as unknown as ServiceSettingEntity,
          true,
        ]);
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('forceLanguage', '');

        expect(result).toBe(true);
        expect(settings.getForceLanguage()).toBeNull();
      });

      it('should accept "null" string to clear forceLanguage', async () => {
        const mockSettingEntity = {
          parameter: 'forceLanguage',
          value: 'null',
          save: sandbox.stub().resolves(),
        };
        sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
          mockSettingEntity as unknown as ServiceSettingEntity,
          true,
        ]);
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('forceLanguage', 'null');

        expect(result).toBe(true);
        expect(settings.getForceLanguage()).toBeNull();
      });

      it('should reject invalid language codes for forceLanguage', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('forceLanguage', 'zz');

        expect(result).toBe(false);
      });

      it('should default to null when not configured', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();

        expect(settings.getForceLanguage()).toBeNull();
      });

      it('should load forceLanguage from database on init', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([
          { parameter: 'forceLanguage', value: 'es' } as unknown as ServiceSettingEntity,
        ]);

        const settings = await ServiceSettings.getInstance();

        expect(settings.getForceLanguage()).toBe('es');
      });
    });

    describe('localeDetectionMethods', () => {
      it('should accept valid detection methods JSON', async () => {
        const methodsJson = '{"urlPrefix":false,"cookie":true,"acceptLanguage":true}';
        const mockSettingEntity = {
          parameter: 'localeDetectionMethods',
          value: methodsJson,
          save: sandbox.stub().resolves(),
        };
        sandbox.stub(ServiceSettingEntity, 'findOrCreate').resolves([
          mockSettingEntity as unknown as ServiceSettingEntity,
          true,
        ]);
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('localeDetectionMethods', methodsJson);

        expect(result).toBe(true);
        expect(settings.getLocaleDetectionMethods()).toEqual({
          urlPrefix: false,
          cookie: true,
          acceptLanguage: true,
        });
      });

      it('should reject invalid JSON for localeDetectionMethods', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.set('localeDetectionMethods', 'not-json');

        expect(result).toBe(false);
      });

      it('should default all methods to true when not configured', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();

        expect(settings.getLocaleDetectionMethods()).toEqual({
          urlPrefix: true,
          cookie: true,
          acceptLanguage: true,
        });
      });

      it('should load localeDetectionMethods from database on init', async () => {
        const methodsJson = '{"urlPrefix":true,"cookie":false,"acceptLanguage":true}';
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([
          { parameter: 'localeDetectionMethods', value: methodsJson } as unknown as ServiceSettingEntity,
        ]);

        const settings = await ServiceSettings.getInstance();

        expect(settings.getLocaleDetectionMethods()).toEqual({
          urlPrefix: true,
          cookie: false,
          acceptLanguage: true,
        });
      });

      it('should default boolean fields to true when missing from stored JSON', async () => {
        const methodsJson = '{}';
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([
          { parameter: 'localeDetectionMethods', value: methodsJson } as unknown as ServiceSettingEntity,
        ]);

        const settings = await ServiceSettings.getInstance();

        expect(settings.getLocaleDetectionMethods()).toEqual({
          urlPrefix: true,
          cookie: true,
          acceptLanguage: true,
        });
      });
    });
  });
});
