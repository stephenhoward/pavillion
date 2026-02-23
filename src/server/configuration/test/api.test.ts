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

    router.get('/handler', siteHandlers.getSettings.bind(siteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.registrationMode).toBe('testValue');
  });

  it('site: should return language settings in response', async () => {
    sandbox.stub(configurationInterface, 'getSetting').resolves(undefined);
    sandbox.stub(configurationInterface, 'getEnabledLanguages').resolves(['en']);
    sandbox.stub(configurationInterface, 'getForceLanguage').resolves('es');

    router.get('/handler', siteHandlers.getSettings.bind(siteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.enabledLanguages).toEqual(['en']);
    expect(response.body.forceLanguage).toBe('es');
    expect(response.body.localeDetectionMethods).toBeUndefined();
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
  });
});
