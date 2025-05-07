import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { testApp } from '@/server/common/test/lib/express';
import { handlers as siteHandlers } from '@/server/configuration/api/v1/site';
import ServiceSettings from '@/server/configuration/service/settings';

describe('Site API', () => {
  let router: express.Router;

  beforeEach(() => {
    router = express.Router();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('site: should succeed', async () => {
    let stub = sinon.stub(ServiceSettings.prototype, 'get');
    let stub2 = sinon.stub(ServiceSettings.prototype, 'init');
    stub.withArgs('registrationMode').returns('testValue');
    router.get('/handler', siteHandlers.site);

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    expect(response.body.registrationMode).toBe('testValue');
  });
});
