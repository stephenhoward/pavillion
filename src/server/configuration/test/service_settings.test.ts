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

      it('should not return removed languages from getInstanceDescription after they are dropped', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        // Simulate the post-update DB state: 'fr' row had its description nullified
        // (policy column null too, so cleanupOrphanSettingsContentRows would
        // destroy it — getInstanceDescription must filter null/empty entries
        // regardless).
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([
          { language: 'en', description: 'Updated', policy: null } as unknown as SettingsContentEntity,
          { language: 'fr', description: null, policy: null } as unknown as SettingsContentEntity,
        ]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.getInstanceDescription();

        expect(result).toEqual({ en: 'Updated' });
        expect(result).not.toHaveProperty('fr');
      });
    });

    describe('instancePolicy', () => {
      beforeEach(() => {
        sandbox.stub(SettingsContentEntity, 'destroy').resolves();
      });

      it('should accept a valid language-keyed object and persist raw markdown source', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([]);
        const findOrCreateStub = sandbox.stub(SettingsContentEntity, 'findOrCreate');
        findOrCreateStub.resolves([
          { language: 'en', policy: 'Hello', save: sandbox.stub().resolves() } as unknown as SettingsContentEntity,
          true,
        ]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy({ en: 'Hello', es: 'Hola' });

        expect(result).toBe(true);
        expect(findOrCreateStub.callCount).toBe(2);
        // Raw markdown source is persisted via the `defaults.policy` payload —
        // no HTML rendering happens at save time.
        const enArgs = findOrCreateStub.firstCall.args[0] as { defaults?: { policy?: string } };
        expect(enArgs.defaults?.policy).toBe('Hello');
        const esArgs = findOrCreateStub.secondCall.args[0] as { defaults?: { policy?: string } };
        expect(esArgs.defaults?.policy).toBe('Hola');
      });

      it('should persist legitimate markdown (headings/lists/links/emphasis/code/blockquote) as raw source', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([]);
        const findOrCreateStub = sandbox.stub(SettingsContentEntity, 'findOrCreate');
        findOrCreateStub.resolves([
          { language: 'en', policy: '', save: sandbox.stub().resolves() } as unknown as SettingsContentEntity,
          true,
        ]);

        const safeMarkdown =
          '## Section\n\n' +
          '### Subsection\n\n' +
          'A paragraph with *emph* and **bold** and `code`.\n\n' +
          '- one\n- two\n\n' +
          '> quote\n\n' +
          '[link](https://example.com)\n' +
          '[mail](mailto:a@b.c)\n';

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy({ en: safeMarkdown });

        expect(result).toBe(true);
        const args = findOrCreateStub.firstCall.args[0] as { defaults?: { policy?: string } };
        // Persisted value is the raw markdown source, byte-for-byte.
        expect(args.defaults?.policy).toBe(safeMarkdown);
      });

      it('should accept an empty object', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy({});

        expect(result).toBe(true);
      });

      it('should reject an array value', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy([] as unknown as Record<string, string>);

        expect(result).toBe(false);
      });

      it('should reject a null value', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy(null as unknown as Record<string, string>);

        expect(result).toBe(false);
      });

      it('should reject values that are not strings', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy({ en: 123 } as unknown as Record<string, string>);

        expect(result).toBe(false);
      });

      it('should accept a value at exactly the input length cap (50000 chars)', async () => {
        const exactText = 'a'.repeat(50000);
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findOrCreate').resolves([
          { language: 'en', policy: exactText, save: sandbox.stub().resolves() } as unknown as SettingsContentEntity,
          true,
        ]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy({ en: exactText });

        expect(result).toBe(true);
      });

      it('should reject a value one character over the input length cap (50001 chars)', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const tooLong = 'a'.repeat(50001);
        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy({ en: tooLong });

        expect(result).toBe(false);
      });

      it('should reject an object with more than 20 language keys', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const tooManyKeys: Record<string, string> = {};
        for (let i = 0; i < 21; i++) {
          tooManyKeys[`k${i}`] = `value ${i}`;
        }

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy(tooManyKeys);

        expect(result).toBe(false);
      });

      it('should reject invalid language codes', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy({ zz: 'some policy' });

        expect(result).toBe(false);
      });

      it('should reject language codes containing a null byte', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy({ 'en\0': 'some policy' } as Record<string, string>);

        expect(result).toBe(false);
      });

      it('should reject overlong language codes (>20 chars)', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);

        const longKey = 'a'.repeat(21);
        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy({ [longKey]: 'some policy' });

        expect(result).toBe(false);
      });

      it('should not return removed languages from getInstancePolicy after they are dropped', async () => {
        // First "call": setInstancePolicy({en, es}) — simulated via DB state below
        // Second "call": setInstancePolicy({en}) — verify es no longer in get response
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        // Post-update DB state: 'es' had its policy nullified; with description
        // also null the orphan-cleanup helper would destroy it, but
        // getInstancePolicy must filter null/empty regardless.
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([
          { language: 'en', description: null, policy: '## Updated' } as unknown as SettingsContentEntity,
          { language: 'es', description: null, policy: null } as unknown as SettingsContentEntity,
        ]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.getInstancePolicy();

        expect(result).toEqual({ en: '## Updated' });
        expect(result).not.toHaveProperty('es');
      });

      it('should nullify policy for removed languages when updating', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        const frSaveStub = sandbox.stub().resolves();
        const frRow = {
          language: 'fr',
          description: null,
          policy: '## Politique',
          save: frSaveStub,
        } as unknown as SettingsContentEntity;
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([
          { language: 'en', description: null, policy: '## Old' } as unknown as SettingsContentEntity,
          frRow,
        ]);
        sandbox.stub(SettingsContentEntity, 'findOrCreate').resolves([
          { language: 'en', policy: '## New', save: sandbox.stub().resolves() } as unknown as SettingsContentEntity,
          false,
        ]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy({ en: 'New' });

        expect(result).toBe(true);
        // 'fr' is not in the new set → policy set to null and saved (preserves the row in case it carries a description)
        expect(frRow.policy).toBeNull();
        expect(frSaveStub.calledOnce).toBe(true);
      });

      it('should load instancePolicy from database as raw markdown source', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([
          { language: 'en', description: null, policy: '## Welcome' } as unknown as SettingsContentEntity,
          { language: 'fr', description: null, policy: '## Bienvenue' } as unknown as SettingsContentEntity,
        ]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.getInstancePolicy();

        expect(result).toEqual({ en: '## Welcome', fr: '## Bienvenue' });
      });

      it('should return empty object when no policies exist', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.getInstancePolicy();

        expect(result).toEqual({});
      });

      describe('reject-on-save dry-render gate (security-critical)', () => {
        // Per memory `feedback-sanitize-on-save`: the persistence layer
        // refuses dangerous input rather than silently downgrading it. The
        // setter dry-renders through marked + DOMPurify and rejects the
        // whole batch if DOMPurify would strip anything. No DB write is
        // attempted — `findOrCreate` and the row-level `save` must NOT be
        // invoked when validation fails.
        const xssVectors: Array<{ name: string; input: string }> = [
          { name: 'raw <script> tag', input: '<script>alert(1)</script>' },
          { name: '<iframe> tag', input: '<iframe src="https://evil.example"></iframe>' },
          { name: '<img> with onerror handler', input: '<img onerror=alert(1) src=x>' },
          { name: 'markdown link with javascript: scheme', input: '[bad](javascript:foo)' },
          { name: '<a> with javascript: href', input: '<a href="javascript:alert(1)">click</a>' },
        ];

        for (const { name, input } of xssVectors) {
          it(`rejects dangerous input (${name}) and writes nothing to the database`, async () => {
            sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
            const findAllContent = sandbox.stub(SettingsContentEntity, 'findAll').resolves([]);
            const findOrCreateStub = sandbox.stub(SettingsContentEntity, 'findOrCreate');

            const settings = await ServiceSettings.getInstance();
            const result = await settings.setInstancePolicy({ en: input });

            expect(result).toBe(false);
            // The dry-render gate runs BEFORE any DB read or write on the
            // present-language path; findOrCreate must not be invoked.
            expect(findOrCreateStub.called).toBe(false);
            // The findAll for the nullify-on-missing scan must also not run
            // — the entire batch is rejected before any DB I/O.
            expect(findAllContent.called).toBe(false);
          });
        }

        it('rejects a batch when even one language carries dangerous input', async () => {
          sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
          const findAllContent = sandbox.stub(SettingsContentEntity, 'findAll').resolves([]);
          const findOrCreateStub = sandbox.stub(SettingsContentEntity, 'findOrCreate');

          const settings = await ServiceSettings.getInstance();
          const result = await settings.setInstancePolicy({
            en: '## Safe heading',
            es: '<script>alert(1)</script>',
          });

          expect(result).toBe(false);
          expect(findOrCreateStub.called).toBe(false);
          expect(findAllContent.called).toBe(false);
        });

        it('rejects h1 headings (intentional allowlist constraint — use h2)', async () => {
          // h1 is intentionally absent from ALLOWED_TAGS because the page
          // already carries a site-level h1; admin-authored h1 would
          // break heading hierarchy. This is not an XSS vector — it is
          // an allowlist constraint — but the persistence layer must
          // still reject so it never stores content the renderer would
          // silently strip.
          sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
          const findAllContent = sandbox.stub(SettingsContentEntity, 'findAll').resolves([]);
          const findOrCreateStub = sandbox.stub(SettingsContentEntity, 'findOrCreate');

          const settings = await ServiceSettings.getInstance();
          const result = await settings.setInstancePolicy({ en: '# Welcome' });

          expect(result).toBe(false);
          expect(findOrCreateStub.called).toBe(false);
          expect(findAllContent.called).toBe(false);
        });
      });
    });

    describe('instanceDescription + instancePolicy coexistence', () => {
      beforeEach(() => {
        sandbox.stub(SettingsContentEntity, 'destroy').resolves();
      });

      it('should preserve policy when only description is updated', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        // Row carries an existing policy; setInstanceDescription must not
        // touch the policy column (it should only manage description).
        const enRow = {
          language: 'en',
          description: 'Old description',
          policy: '## Existing policy',
          save: sandbox.stub().resolves(),
        } as unknown as SettingsContentEntity;
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([enRow]);
        sandbox.stub(SettingsContentEntity, 'findOrCreate').resolves([enRow, false]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstanceDescription({ en: 'New description' });

        expect(result).toBe(true);
        expect(enRow.description).toBe('New description');
        // Policy column untouched on this code path
        expect(enRow.policy).toBe('## Existing policy');
      });

      it('should preserve description when only policy is updated', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        const enRow = {
          language: 'en',
          description: 'Existing description',
          policy: '## Old policy',
          save: sandbox.stub().resolves(),
        } as unknown as SettingsContentEntity;
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([enRow]);
        sandbox.stub(SettingsContentEntity, 'findOrCreate').resolves([enRow, false]);

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy({ en: '## New policy source' });

        expect(result).toBe(true);
        // Description column untouched on this code path
        expect(enRow.description).toBe('Existing description');
        // Policy column receives the raw markdown source byte-for-byte —
        // no rendering happens at save time.
        expect(enRow.policy).toBe('## New policy source');
      });

      it('should preserve description when policy is cleared (description set, policy null still keeps row)', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        const enSaveStub = sandbox.stub().resolves();
        const enRow = {
          language: 'en',
          description: 'Existing description',
          policy: '## Existing policy',
          save: enSaveStub,
        } as unknown as SettingsContentEntity;
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([enRow]);
        // setInstancePolicy({}) — no findOrCreate calls expected
        const findOrCreateStub = sandbox.stub(SettingsContentEntity, 'findOrCreate');

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy({});

        expect(result).toBe(true);
        // Policy nullified, description preserved
        expect(enRow.policy).toBeNull();
        expect(enRow.description).toBe('Existing description');
        expect(enSaveStub.calledOnce).toBe(true);
        expect(findOrCreateStub.called).toBe(false);
      });

      it('should preserve policy when description is cleared (policy set, description null still keeps row)', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        const enSaveStub = sandbox.stub().resolves();
        const enRow = {
          language: 'en',
          description: 'Existing description',
          policy: '## Existing policy',
          save: enSaveStub,
        } as unknown as SettingsContentEntity;
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([enRow]);
        const findOrCreateStub = sandbox.stub(SettingsContentEntity, 'findOrCreate');

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstanceDescription({});

        expect(result).toBe(true);
        // Description nullified, policy preserved
        expect(enRow.description).toBeNull();
        expect(enRow.policy).toBe('## Existing policy');
        expect(enSaveStub.calledOnce).toBe(true);
        expect(findOrCreateStub.called).toBe(false);
      });

      it('should call cleanupOrphanSettingsContentRows after description update so rows with both columns empty are destroyed', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([]);
        const destroyStub = SettingsContentEntity.destroy as unknown as sinon.SinonStub;

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstanceDescription({});

        expect(result).toBe(true);
        // The orphan cleanup helper should have been invoked
        expect(destroyStub.called).toBe(true);
      });

      it('should call cleanupOrphanSettingsContentRows after policy update so rows with both columns empty are destroyed', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([]);
        const destroyStub = SettingsContentEntity.destroy as unknown as sinon.SinonStub;

        const settings = await ServiceSettings.getInstance();
        const result = await settings.setInstancePolicy({});

        expect(result).toBe(true);
        // The orphan cleanup helper should have been invoked
        expect(destroyStub.called).toBe(true);
      });

      it('should preserve both columns on a single row when description and policy are set for the same language', async () => {
        sandbox.stub(ServiceSettingEntity, 'findAll').resolves([]);
        const enRow = {
          language: 'en',
          description: 'Initial description',
          policy: '## Initial policy',
          save: sandbox.stub().resolves(),
        } as unknown as SettingsContentEntity;
        sandbox.stub(SettingsContentEntity, 'findAll').resolves([enRow]);
        sandbox.stub(SettingsContentEntity, 'findOrCreate').resolves([enRow, false]);

        const settings = await ServiceSettings.getInstance();
        // Both getters should reflect both columns from the same row
        const description = await settings.getInstanceDescription();
        const policy = await settings.getInstancePolicy();

        expect(description).toEqual({ en: 'Initial description' });
        expect(policy).toEqual({ en: '## Initial policy' });
      });
    });
  });
});
