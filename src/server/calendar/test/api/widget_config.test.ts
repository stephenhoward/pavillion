import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';

import { Account } from '@/common/model/account';
import { InvalidDomainFormatError } from '@/common/exceptions/calendar';
import { testApp } from '@/server/common/test/lib/express';
import WidgetConfigRoutes from '@/server/calendar/api/v1/widget-config';
import CalendarInterface from '@/server/calendar/interface';

describe('WidgetConfigRoutes.setDomain', () => {
  let routes: WidgetConfigRoutes;
  let router: express.Router;
  let mockInterface: CalendarInterface;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    mockInterface = {
      setWidgetDomain: sandbox.stub(),
    } as any;

    routes = new WidgetConfigRoutes(mockInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return 400 with static error string when InvalidDomainFormatError is thrown', async () => {
    const setWidgetDomainStub = mockInterface.setWidgetDomain as sinon.SinonStub;
    setWidgetDomainStub.rejects(new InvalidDomainFormatError());

    router.put('/handler', (req, res) => {
      req.user = new Account('account-id', 'testuser', 'test@example.com');
      req.params.calendarId = '550e8400-e29b-41d4-a716-446655440000';
      req.body = { domain: 'https://example.com' };
      routes.setDomain(req, res);
    });

    const response = await request(testApp(router))
      .put('/handler')
      .send({ domain: 'https://example.com' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid domain format');
    expect(response.body.errorName).toBe('InvalidDomainFormatError');
  });

  it('should not expose error.message in the response body', async () => {
    const setWidgetDomainStub = mockInterface.setWidgetDomain as sinon.SinonStub;
    setWidgetDomainStub.rejects(new InvalidDomainFormatError());

    router.put('/handler', (req, res) => {
      req.user = new Account('account-id', 'testuser', 'test@example.com');
      req.params.calendarId = '550e8400-e29b-41d4-a716-446655440000';
      req.body = { domain: 'https://example.com' };
      routes.setDomain(req, res);
    });

    const response = await request(testApp(router))
      .put('/handler')
      .send({ domain: 'https://example.com' });

    const responseBody = JSON.stringify(response.body);
    expect(responseBody).not.toContain('Domain must not include protocol or path');
  });

  it('should return 500 with generic error for unexpected errors', async () => {
    const setWidgetDomainStub = mockInterface.setWidgetDomain as sinon.SinonStub;
    setWidgetDomainStub.rejects(new Error('Some internal database failure'));

    router.put('/handler', (req, res) => {
      req.user = new Account('account-id', 'testuser', 'test@example.com');
      req.params.calendarId = '550e8400-e29b-41d4-a716-446655440000';
      req.body = { domain: 'example.com' };
      routes.setDomain(req, res);
    });

    const response = await request(testApp(router))
      .put('/handler')
      .send({ domain: 'example.com' });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('An error occurred while setting widget domain');

    // Should not leak internal error details
    const responseBody = JSON.stringify(response.body);
    expect(responseBody).not.toContain('database failure');
  });
});
