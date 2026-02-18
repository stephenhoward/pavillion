import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';
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
    const eventBus = new EventEmitter();
    configurationInterface = new ConfigurationInterface(eventBus);
    siteHandlers = new SiteRouteHandlers(configurationInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('site: should succeed', async () => {
    let mockSettings = {
      get: sinon.stub().withArgs('registrationMode').returns('testValue'),
      getEnabledLanguages: sinon.stub().returns(['en', 'es']),
      getForceLanguage: sinon.stub().returns(null),
      getLocaleDetectionMethods: sinon.stub().returns({ urlPrefix: true, cookie: true, acceptLanguage: true }),
    };
    let getInstanceStub = sandbox.stub(configurationInterface, 'getInstance');
    getInstanceStub.resolves(mockSettings as any);

    router.get('/handler', siteHandlers.getSettings.bind(siteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.registrationMode).toBe('testValue');
    expect(getInstanceStub.called).toBe(true);
  });

  it('site: should return language settings in response', async () => {
    let mockSettings = {
      get: sinon.stub().returns(undefined),
      getEnabledLanguages: sinon.stub().returns(['en']),
      getForceLanguage: sinon.stub().returns('es'),
      getLocaleDetectionMethods: sinon.stub().returns({ urlPrefix: false, cookie: true, acceptLanguage: true }),
    };
    let getInstanceStub = sandbox.stub(configurationInterface, 'getInstance');
    getInstanceStub.resolves(mockSettings as any);

    router.get('/handler', siteHandlers.getSettings.bind(siteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.enabledLanguages).toEqual(['en']);
    expect(response.body.forceLanguage).toBe('es');
    expect(response.body.localeDetectionMethods).toEqual({ urlPrefix: false, cookie: true, acceptLanguage: true });
  });

  describe('updateSettings', () => {
    it('should serialize enabledLanguages as JSON for storage', async () => {
      const mockSaveStub = sinon.stub().resolves(true);
      let mockSettings = {
        set: mockSaveStub,
        getEnabledLanguages: sinon.stub().returns(['en', 'es']),
        getForceLanguage: sinon.stub().returns(null),
        getLocaleDetectionMethods: sinon.stub().returns({ urlPrefix: true, cookie: true, acceptLanguage: true }),
      };
      let getInstanceStub = sandbox.stub(configurationInterface, 'getInstance');
      getInstanceStub.resolves(mockSettings as any);

      router.post('/handler', siteHandlers.updateSettings.bind(siteHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({ enabledLanguages: ['en', 'es'] });

      expect(response.status).toBe(200);
      expect(mockSaveStub.calledWith('enabledLanguages', JSON.stringify(['en', 'es']))).toBe(true);
    });

    it('should serialize localeDetectionMethods as JSON for storage', async () => {
      const mockSaveStub = sinon.stub().resolves(true);
      let mockSettings = {
        set: mockSaveStub,
        getEnabledLanguages: sinon.stub().returns(['en']),
        getForceLanguage: sinon.stub().returns(null),
        getLocaleDetectionMethods: sinon.stub().returns({ urlPrefix: true, cookie: true, acceptLanguage: true }),
      };
      let getInstanceStub = sandbox.stub(configurationInterface, 'getInstance');
      getInstanceStub.resolves(mockSettings as any);

      router.post('/handler', siteHandlers.updateSettings.bind(siteHandlers));

      const methods = { urlPrefix: false, cookie: true, acceptLanguage: true };
      const response = await request(testApp(router))
        .post('/handler')
        .send({ localeDetectionMethods: methods });

      expect(response.status).toBe(200);
      expect(mockSaveStub.calledWith('localeDetectionMethods', JSON.stringify(methods))).toBe(true);
    });

    it('should pass forceLanguage as a plain string', async () => {
      const mockSaveStub = sinon.stub().resolves(true);
      let mockSettings = {
        set: mockSaveStub,
        getEnabledLanguages: sinon.stub().returns(['en']),
        getForceLanguage: sinon.stub().returns(null),
        getLocaleDetectionMethods: sinon.stub().returns({ urlPrefix: true, cookie: true, acceptLanguage: true }),
      };
      let getInstanceStub = sandbox.stub(configurationInterface, 'getInstance');
      getInstanceStub.resolves(mockSettings as any);

      router.post('/handler', siteHandlers.updateSettings.bind(siteHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({ forceLanguage: 'es' });

      expect(response.status).toBe(200);
      expect(mockSaveStub.calledWith('forceLanguage', 'es')).toBe(true);
    });
  });
});
