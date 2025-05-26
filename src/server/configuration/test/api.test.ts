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
    };
    let getInstanceStub = sandbox.stub(configurationInterface, 'getInstance');
    getInstanceStub.resolves(mockSettings as any);

    router.get('/handler', siteHandlers.getSettings.bind(siteHandlers));

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.registrationMode).toBe('testValue');
    expect(getInstanceStub.called).toBe(true);
  });
});
