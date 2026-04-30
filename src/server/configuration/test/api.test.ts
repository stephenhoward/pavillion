import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { testApp } from '@/server/common/test/lib/express';
import SiteRouteHandlers from '@/server/configuration/api/v1/site';
import ConfigurationInterface from '@/server/configuration/interface';

describe('Site API', () => {
  let router: express.Router;
  let siteHandlers: SiteRouteHandlers;
  let configurationInterface: ConfigurationInterface;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    router = express.Router();
    configurationInterface = new ConfigurationInterface();
    siteHandlers = new SiteRouteHandlers(configurationInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('site: should succeed', async () => {
    sandbox.stub(configurationInterface, 'getSetting').withArgs('registrationMode').resolves('testValue');
    sandbox.stub(configurationInterface, 'getEnabledLanguages').resolves(['en', 'es']);
    sandbox.stub(configurationInterface, 'getForceLanguage').resolves(null);
    sandbox.stub(configurationInterface, 'getInstanceDescription').resolves({});
    sandbox.stub(configurationInterface, 'getInstancePolicy').resolves({});

    router.get('/handler', siteHandlers.getSettings.bind(siteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.registrationMode).toBe('testValue');
  });

  it('site: should return language settings in response', async () => {
    sandbox.stub(configurationInterface, 'getSetting').resolves(undefined);
    sandbox.stub(configurationInterface, 'getEnabledLanguages').resolves(['en']);
    sandbox.stub(configurationInterface, 'getForceLanguage').resolves('es');
    sandbox.stub(configurationInterface, 'getInstanceDescription').resolves({});
    sandbox.stub(configurationInterface, 'getInstancePolicy').resolves({});

    router.get('/handler', siteHandlers.getSettings.bind(siteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.enabledLanguages).toEqual(['en']);
    expect(response.body.forceLanguage).toBe('es');
    expect(response.body.localeDetectionMethods).toBeUndefined();
  });

  describe('getSettings instanceDescription', () => {
    it('should include instanceDescription in the response', async () => {
      sandbox.stub(configurationInterface, 'getSetting').resolves(undefined);
      sandbox.stub(configurationInterface, 'getEnabledLanguages').resolves(['en']);
      sandbox.stub(configurationInterface, 'getForceLanguage').resolves(null);
      sandbox.stub(configurationInterface, 'getInstanceDescription').resolves({ en: 'Community events calendar' });
      sandbox.stub(configurationInterface, 'getInstancePolicy').resolves({});

      router.get('/handler', siteHandlers.getSettings.bind(siteHandlers));

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.instanceDescription).toEqual({ en: 'Community events calendar' });
    });

    it('should return empty object when instanceDescription is not configured', async () => {
      sandbox.stub(configurationInterface, 'getSetting').resolves(undefined);
      sandbox.stub(configurationInterface, 'getEnabledLanguages').resolves(['en']);
      sandbox.stub(configurationInterface, 'getForceLanguage').resolves(null);
      sandbox.stub(configurationInterface, 'getInstanceDescription').resolves({});
      sandbox.stub(configurationInterface, 'getInstancePolicy').resolves({});

      router.get('/handler', siteHandlers.getSettings.bind(siteHandlers));

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.instanceDescription).toEqual({});
    });

    it('should return multi-language instanceDescription', async () => {
      sandbox.stub(configurationInterface, 'getSetting').resolves(undefined);
      sandbox.stub(configurationInterface, 'getEnabledLanguages').resolves(['en', 'es']);
      sandbox.stub(configurationInterface, 'getForceLanguage').resolves(null);
      sandbox.stub(configurationInterface, 'getInstanceDescription').resolves({ en: 'Welcome', es: 'Bienvenido' });
      sandbox.stub(configurationInterface, 'getInstancePolicy').resolves({});

      router.get('/handler', siteHandlers.getSettings.bind(siteHandlers));

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.instanceDescription).toEqual({ en: 'Welcome', es: 'Bienvenido' });
    });
  });

  describe('getSettings instancePolicy', () => {
    it('should include instancePolicy in the response', async () => {
      sandbox.stub(configurationInterface, 'getSetting').resolves(undefined);
      sandbox.stub(configurationInterface, 'getEnabledLanguages').resolves(['en']);
      sandbox.stub(configurationInterface, 'getForceLanguage').resolves(null);
      sandbox.stub(configurationInterface, 'getInstanceDescription').resolves({});
      sandbox.stub(configurationInterface, 'getInstancePolicy').resolves({ en: '<p>Be excellent to each other.</p>' });

      router.get('/handler', siteHandlers.getSettings.bind(siteHandlers));

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.instancePolicy).toEqual({ en: '<p>Be excellent to each other.</p>' });
    });

    it('should return empty object when instancePolicy is not configured', async () => {
      sandbox.stub(configurationInterface, 'getSetting').resolves(undefined);
      sandbox.stub(configurationInterface, 'getEnabledLanguages').resolves(['en']);
      sandbox.stub(configurationInterface, 'getForceLanguage').resolves(null);
      sandbox.stub(configurationInterface, 'getInstanceDescription').resolves({});
      sandbox.stub(configurationInterface, 'getInstancePolicy').resolves({});

      router.get('/handler', siteHandlers.getSettings.bind(siteHandlers));

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.instancePolicy).toEqual({});
    });

    it('should return multi-language instancePolicy', async () => {
      sandbox.stub(configurationInterface, 'getSetting').resolves(undefined);
      sandbox.stub(configurationInterface, 'getEnabledLanguages').resolves(['en', 'es']);
      sandbox.stub(configurationInterface, 'getForceLanguage').resolves(null);
      sandbox.stub(configurationInterface, 'getInstanceDescription').resolves({});
      sandbox.stub(configurationInterface, 'getInstancePolicy').resolves({ en: '<p>EN policy</p>', es: '<p>ES policy</p>' });

      router.get('/handler', siteHandlers.getSettings.bind(siteHandlers));

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.instancePolicy).toEqual({ en: '<p>EN policy</p>', es: '<p>ES policy</p>' });
    });
  });

  describe('updateSettings', () => {
    it('should serialize enabledLanguages as JSON for storage', async () => {
      const mockSaveStub = sandbox.stub(configurationInterface, 'setSetting').resolves(true);

      router.post('/handler', siteHandlers.updateSettings.bind(siteHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({ enabledLanguages: ['en', 'es'] });

      expect(response.status).toBe(200);
      expect(mockSaveStub.calledWith('enabledLanguages', JSON.stringify(['en', 'es']))).toBe(true);
    });

    it('should pass forceLanguage as a plain string', async () => {
      const mockSaveStub = sandbox.stub(configurationInterface, 'setSetting').resolves(true);

      router.post('/handler', siteHandlers.updateSettings.bind(siteHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({ forceLanguage: 'es' });

      expect(response.status).toBe(200);
      expect(mockSaveStub.calledWith('forceLanguage', 'es')).toBe(true);
    });

    it('should silently skip unknown keys and not call setSetting for them', async () => {
      const mockSaveStub = sandbox.stub(configurationInterface, 'setSetting').resolves(true);

      router.post('/handler', siteHandlers.updateSettings.bind(siteHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({ registrationMode: 'open', unknownKey: 'malicious', anotherBadKey: 'data' });

      expect(response.status).toBe(200);
      // setSetting should only have been called for the allowed key
      expect(mockSaveStub.callCount).toBe(1);
      expect(mockSaveStub.calledWith('registrationMode', 'open')).toBe(true);
      expect(mockSaveStub.calledWith('unknownKey', 'malicious')).toBe(false);
      expect(mockSaveStub.calledWith('anotherBadKey', 'data')).toBe(false);
    });

    it('should succeed with no error when only unknown keys are sent', async () => {
      const mockSaveStub = sandbox.stub(configurationInterface, 'setSetting').resolves(true);

      router.post('/handler', siteHandlers.updateSettings.bind(siteHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({ unknownKey: 'value' });

      expect(response.status).toBe(200);
      expect(mockSaveStub.callCount).toBe(0);
    });

    it('should call setInstanceDescription for instanceDescription', async () => {
      const mockDescStub = sandbox.stub(configurationInterface, 'setInstanceDescription').resolves(true);
      sandbox.stub(configurationInterface, 'setSetting').resolves(true);

      router.post('/handler', siteHandlers.updateSettings.bind(siteHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({ instanceDescription: { en: 'Community events' } });

      expect(response.status).toBe(200);
      expect(mockDescStub.calledWith({ en: 'Community events' })).toBe(true);
    });

    it('should return 400 when instanceDescription validation fails', async () => {
      const mockDescStub = sandbox.stub(configurationInterface, 'setInstanceDescription').resolves(false);

      router.post('/handler', siteHandlers.updateSettings.bind(siteHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({ instanceDescription: { en: 'Some description' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('instanceDescription');
      expect(mockDescStub.calledOnce).toBe(true);
    });

    it('should persist multi-language instanceDescription', async () => {
      const mockDescStub = sandbox.stub(configurationInterface, 'setInstanceDescription').resolves(true);
      sandbox.stub(configurationInterface, 'setSetting').resolves(true);

      router.post('/handler', siteHandlers.updateSettings.bind(siteHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({ instanceDescription: { en: 'Welcome', es: 'Bienvenido' } });

      expect(response.status).toBe(200);
      expect(mockDescStub.calledWith({ en: 'Welcome', es: 'Bienvenido' })).toBe(true);
    });

    it('should call setInstancePolicy for instancePolicy', async () => {
      const mockPolicyStub = sandbox.stub(configurationInterface, 'setInstancePolicy').resolves(true);
      sandbox.stub(configurationInterface, 'setSetting').resolves(true);

      router.post('/handler', siteHandlers.updateSettings.bind(siteHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({ instancePolicy: { en: '# Community guidelines' } });

      expect(response.status).toBe(200);
      expect(mockPolicyStub.calledWith({ en: '# Community guidelines' })).toBe(true);
    });

    it('should return 400 when instancePolicy validation fails', async () => {
      const mockPolicyStub = sandbox.stub(configurationInterface, 'setInstancePolicy').resolves(false);

      router.post('/handler', siteHandlers.updateSettings.bind(siteHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({ instancePolicy: { en: 'Some policy' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('instancePolicy');
      expect(mockPolicyStub.calledOnce).toBe(true);
    });

    it('should persist multi-language instancePolicy', async () => {
      const mockPolicyStub = sandbox.stub(configurationInterface, 'setInstancePolicy').resolves(true);
      sandbox.stub(configurationInterface, 'setSetting').resolves(true);

      router.post('/handler', siteHandlers.updateSettings.bind(siteHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({ instancePolicy: { en: '# EN', es: '# ES' } });

      expect(response.status).toBe(200);
      expect(mockPolicyStub.calledWith({ en: '# EN', es: '# ES' })).toBe(true);
    });
  });
});
