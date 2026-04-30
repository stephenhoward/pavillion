import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import ServiceSettings from '@/server/configuration/service/settings';
import ServiceSettingEntity from '@/server/configuration/entity/settings';
import SettingsContentEntity from '@/server/configuration/entity/settings_content';

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

        // Default should include all available languages
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

    describe('instanceDescription', () => {
      beforeEach(() => {
        sandbox.stub(SettingsContentEntity, 'destroy').resolves();
      });

      it('should accept a valid language-keyed object', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([]);
        const findOrCreateStub = sandbox.stub(SettingsContentEntity, 'findOrCreate');
        findOrCreateStub.resolves([{ language: 'en', description: 'Hello', save: sandbox.stub().resolves() } as unknown as SettingsContentEntity, true]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstanceDescription({ en: 'Hello', es: 'Hola' });

        expect(result).toBe(true);
        expect(findOrCreateStub.callCount).toBe(2);
      });

      it('should accept an empty object', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstanceDescription({});

        expect(result).toBe(true);
      });

      it('should reject an array value', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstanceDescription([] as unknown as Record<string, string>);

        expect(result).toBe(false);
      });

      it('should reject a null value', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstanceDescription(null as unknown as Record<string, string>);

        expect(result).toBe(false);
      });

      it('should reject values that are not strings', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstanceDescription({ en: 123 } as unknown as Record<string, string>);

        expect(result).toBe(false);
      });

      it('should reject values exceeding 500 characters', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const longText = 'a'.repeat(501);
        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstanceDescription({ en: longText });

        expect(result).toBe(false);
      });

      it('should accept values at exactly 500 characters', async () => {
        const exactText = 'a'.repeat(500);
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findOrCreate').resolves([
          { language: 'en', description: exactText, save: sandbox.stub().resolves() } as unknown as SettingsContentEntity,
          true,
        ]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstanceDescription({ en: exactText });

        expect(result).toBe(true);
      });

      it('should reject an object with more than 20 language keys', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const tooManyKeys: Record<string, string> = {};
        for (let i = 0; i < 21; i++) {
          tooManyKeys[`k${i}`] = `value ${i}`;
        }

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstanceDescription(tooManyKeys);

        expect(result).toBe(false);
      });

      it('should reject invalid language codes', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstanceDescription({ zz: 'invalid lang' });

        expect(result).toBe(false);
      });

      it('should load instanceDescription from database', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([
          { language: 'en', description: 'Welcome' } as unknown as SettingsContentEntity,
          { language: 'fr', description: 'Bienvenue' } as unknown as SettingsContentEntity,
        ]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.getInstanceDescription();

        expect(result).toEqual({ en: 'Welcome', fr: 'Bienvenue' });
      });

      it('should return empty object when no descriptions exist', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.getInstanceDescription();

        expect(result).toEqual({});
      });

      it('should nullify description for removed languages when updating', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        const frSaveStub = sandbox.stub().resolves();
        const frRow = {
          language: 'fr',
          description: 'Bonjour',
          policy: null,
          save: frSaveStub,
        } as unknown as SettingsContentEntity;
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([
          { language: 'en', description: 'Hello', policy: null } as unknown as SettingsContentEntity,
          frRow,
        ]);
        sandbox.stub(SettingsContentEntity, 'findOrCreate').resolves([
          { language: 'en', description: 'Updated', save: sandbox.stub().resolves() } as unknown as SettingsContentEntity,
          false,
        ]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstanceDescription({ en: 'Updated' });

        expect(result).toBe(true);
        // 'fr' is not in the new set → description set to null and saved (preserves the row in case it carries a policy)
        expect(frRow.description).toBeNull();
        expect(frSaveStub.calledOnce).toBe(true);
      });

      it('should update existing descriptions', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        const saveStub = sandbox.stub().resolves();
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([
          { language: 'en', description: 'Old', destroy: sandbox.stub().resolves() } as unknown as SettingsContentEntity,
        ]);
        sandbox.stub(SettingsContentEntity, 'findOrCreate').resolves([
          { language: 'en', description: 'Old', save: saveStub } as unknown as SettingsContentEntity,
          false,
        ]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstanceDescription({ en: 'New' });

        expect(result).toBe(true);
        expect(saveStub.calledOnce).toBe(true);
      });
    });
  });
});
