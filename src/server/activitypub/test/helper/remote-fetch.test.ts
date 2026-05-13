import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import sinon from 'sinon';
import { fetchRemoteObject } from '@/server/activitypub/helper/remote-fetch';
import { REMOTE_OBJECT_FETCH_TIMEOUT_MS } from '@/server/common/constants';
import { Calendar } from '@/common/model/calendar';
import CalendarActorService from '@/server/activitypub/service/calendar_actor';

describe('fetchRemoteObject', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let axiosGetStub: sinon.SinonStub;

  beforeEach(() => {
    axiosGetStub = sandbox.stub(axios, 'get');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fetch and return a remote ActivityPub object', async () => {
    const mockObject = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://remote.example/events/123',
      type: 'Event',
      name: 'Test Event',
    };

    axiosGetStub.resolves({
      status: 200,
      data: mockObject,
    });

    const result = await fetchRemoteObject('https://remote.example/events/123');

    expect(result).toEqual(mockObject);
    expect(axiosGetStub.calledOnce).toBe(true);
    expect(axiosGetStub.calledWith(
      'https://remote.example/events/123',
      sinon.match({
        headers: {
          'Accept': 'application/activity+json',
          'User-Agent': 'Pavillion ActivityPub Server',
        },
        timeout: REMOTE_OBJECT_FETCH_TIMEOUT_MS,
      }),
    )).toBe(true);
  });

  it('should use proper Accept header for ActivityPub content negotiation', async () => {
    axiosGetStub.resolves({
      status: 200,
      data: { type: 'Note' },
    });

    await fetchRemoteObject('https://remote.example/notes/456');

    const callArgs = axiosGetStub.firstCall.args[1];
    expect(callArgs.headers['Accept']).toBe('application/activity+json');
  });

  it('should use a 5 second timeout', async () => {
    axiosGetStub.resolves({
      status: 200,
      data: { type: 'Note' },
    });

    await fetchRemoteObject('https://remote.example/notes/456');

    const callArgs = axiosGetStub.firstCall.args[1];
    expect(callArgs.timeout).toBe(5000);
  });

  it('should set maxRedirects to 0 to prevent redirect-based SSRF', async () => {
    axiosGetStub.resolves({
      status: 200,
      data: { type: 'Note' },
    });

    await fetchRemoteObject('https://remote.example/notes/456');

    const callArgs = axiosGetStub.firstCall.args[1];
    expect(callArgs.maxRedirects).toBe(0);
  });

  it('should return null when HTTP response is not 200', async () => {
    axiosGetStub.resolves({
      status: 404,
      data: null,
    });

    const result = await fetchRemoteObject('https://remote.example/events/notfound');

    expect(result).toBeNull();
  });

  it('should return null on network error', async () => {
    const networkError = new Error('Network Error');
    (networkError as any).request = {};
    (networkError as any).isAxiosError = true;
    sandbox.stub(axios, 'isAxiosError').returns(true);
    axiosGetStub.rejects(networkError);

    const result = await fetchRemoteObject('https://unreachable.example/events/123');

    expect(result).toBeNull();
  });

  it('should return null on timeout', async () => {
    const timeoutError = new Error('timeout of 5000ms exceeded');
    (timeoutError as any).code = 'ECONNABORTED';
    (timeoutError as any).isAxiosError = true;
    sandbox.stub(axios, 'isAxiosError').returns(true);
    axiosGetStub.rejects(timeoutError);

    const result = await fetchRemoteObject('https://slow.example/events/123');

    expect(result).toBeNull();
  });

  it('should return null on HTTP error response', async () => {
    const httpError = new Error('Request failed with status code 500');
    (httpError as any).response = { status: 500 };
    (httpError as any).isAxiosError = true;
    sandbox.stub(axios, 'isAxiosError').returns(true);
    axiosGetStub.rejects(httpError);

    const result = await fetchRemoteObject('https://remote.example/events/error');

    expect(result).toBeNull();
  });

  it('should return null on unexpected error', async () => {
    const unexpectedError = new Error('Unexpected error');
    sandbox.stub(axios, 'isAxiosError').returns(false);
    axiosGetStub.rejects(unexpectedError);

    const result = await fetchRemoteObject('https://remote.example/events/123');

    expect(result).toBeNull();
  });

  it('should handle axios error without response or request', async () => {
    const axiosError = new Error('Unknown axios error');
    (axiosError as any).isAxiosError = true;
    sandbox.stub(axios, 'isAxiosError').returns(true);
    axiosGetStub.rejects(axiosError);

    const result = await fetchRemoteObject('https://remote.example/events/123');

    expect(result).toBeNull();
  });

  it('should return null when axios throws a 302 redirect AxiosError', async () => {
    const redirectError = new Error('Redirect');
    (redirectError as any).response = { status: 302 };
    (redirectError as any).isAxiosError = true;
    sandbox.stub(axios, 'isAxiosError').returns(true);
    axiosGetStub.rejects(redirectError);

    const result = await fetchRemoteObject('https://remote.example/events/123');

    expect(result).toBeNull();
  });

  it('should return the full object with nested properties', async () => {
    const complexObject = {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        { '@language': 'en' },
      ],
      id: 'https://remote.example/events/123',
      type: 'Event',
      name: 'Community Gathering',
      startTime: '2025-03-15T14:00:00Z',
      location: {
        type: 'Place',
        name: 'Community Center',
        address: '123 Main St',
      },
      attributedTo: {
        type: 'Organization',
        name: 'Local Community Group',
      },
    };

    axiosGetStub.resolves({
      status: 200,
      data: complexObject,
    });

    const result = await fetchRemoteObject('https://remote.example/events/123');

    expect(result).toEqual(complexObject);
  });

  describe('SSRF Protection - Private IP Blocking', () => {
    it('should reject URI with private IPv4 address (10.0.0.0/8)', async () => {
      const result = await fetchRemoteObject('http://10.0.0.1/events/123');

      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
    });

    it('should reject URI with private IPv4 address (192.168.0.0/16)', async () => {
      const result = await fetchRemoteObject('http://192.168.1.1/events/123');

      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
    });

    it('should reject URI with loopback address (127.0.0.1)', async () => {
      const result = await fetchRemoteObject('http://127.0.0.1:3000/events/123');

      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
    });

    it('should reject URI with link-local address (169.254.169.254 - AWS metadata)', async () => {
      const result = await fetchRemoteObject('http://169.254.169.254/latest/meta-data');

      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
    });

    it('should reject URI with private IPv6 address (::1)', async () => {
      const result = await fetchRemoteObject('http://[::1]/events/123');

      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
    });

    it('should reject URI with IPv6 link-local address (fe80::)', async () => {
      const result = await fetchRemoteObject('http://[fe80::1]/events/123');

      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
    });

    it('should allow URI with public IP address', async () => {
      axiosGetStub.resolves({
        status: 200,
        data: { type: 'Event', name: 'Public Event' },
      });

      const result = await fetchRemoteObject('https://8.8.8.8/events/123');

      expect(result).not.toBeNull();
      expect(axiosGetStub.called).toBe(true);
    });
  });

  describe('Signed GET path', () => {
    const SIGNING_CALENDAR_ID = 'signing-calendar-id';
    const SIGNING_CALENDAR_URLNAME = 'community-events';
    const SIGNING_ACTOR_URI = 'https://local.test/calendars/community-events';
    const TARGET_URI = 'https://remote.example/users/alice/outbox';
    const MOCK_SIGNATURE = 'mock-signature-base64-value';
    const MOCK_DATE = 'Wed, 13 May 2026 12:00:00 GMT';

    function makeSigningCalendar(): Calendar {
      return new Calendar(SIGNING_CALENDAR_ID, SIGNING_CALENDAR_URLNAME);
    }

    function stubActorLookupAndSigning() {
      sandbox.stub(CalendarActorService.prototype, 'getActorByCalendarId').resolves({
        id: 'actor-id-123',
        calendarId: SIGNING_CALENDAR_ID,
        actorUri: SIGNING_ACTOR_URI,
        publicKey: 'PUBLIC_KEY_PEM',
        privateKey: 'PRIVATE_KEY_PEM',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      const signStub = sandbox.stub(CalendarActorService.prototype, 'signActivity').resolves({
        keyId: `${SIGNING_ACTOR_URI}#main-key`,
        signature: MOCK_SIGNATURE,
        algorithm: 'rsa-sha256',
        headers: '(request-target) host date',
        date: MOCK_DATE,
      });
      return signStub;
    }

    it('attaches an HTTP Signature header when a signing calendar is provided', async () => {
      const signStub = stubActorLookupAndSigning();
      axiosGetStub.resolves({ status: 200, data: { type: 'OrderedCollection' } });

      const result = await fetchRemoteObject(TARGET_URI, makeSigningCalendar());

      expect(result).toEqual({ type: 'OrderedCollection' });
      expect(axiosGetStub.calledOnce).toBe(true);
      const callArgs = axiosGetStub.firstCall.args[1];
      const signatureHeader = callArgs.headers.Signature as string;
      expect(signatureHeader).toBeDefined();
      // Signature header must reference the calendar actor's keyId, the
      // signing algorithm, the headers list including (request-target), and
      // the base64 signature value.
      expect(signatureHeader).toContain(`keyId="${SIGNING_ACTOR_URI}#main-key"`);
      expect(signatureHeader).toContain('algorithm="rsa-sha256"');
      expect(signatureHeader).toContain('headers="(request-target) host date"');
      expect(signatureHeader).toContain(`signature="${MOCK_SIGNATURE}"`);
      expect(callArgs.headers.Date).toBe(MOCK_DATE);

      // signActivity must be invoked with method='get' and no digest so the
      // (request-target) pseudo-header reflects the actual HTTP verb.
      expect(signStub.calledOnce).toBe(true);
      const signCallArgs = signStub.firstCall.args;
      expect(signCallArgs[0]).toBe(SIGNING_ACTOR_URI); // actorUri
      expect(signCallArgs[2]).toBe(TARGET_URI);        // targetUrl
      expect(signCallArgs[3]).toBeUndefined();          // digest omitted for GET
      expect(signCallArgs[4]).toBe('get');              // method
    });

    it('preserves Accept and User-Agent headers alongside signature headers', async () => {
      stubActorLookupAndSigning();
      axiosGetStub.resolves({ status: 200, data: { type: 'OrderedCollection' } });

      await fetchRemoteObject(TARGET_URI, makeSigningCalendar());

      const callArgs = axiosGetStub.firstCall.args[1];
      expect(callArgs.headers['Accept']).toBe('application/activity+json');
      expect(callArgs.headers['User-Agent']).toBe('Pavillion ActivityPub Server');
    });

    it('returns null and skips the HTTP request when the calendar has no actor', async () => {
      sandbox.stub(CalendarActorService.prototype, 'getActorByCalendarId').resolves(null);

      const result = await fetchRemoteObject(TARGET_URI, makeSigningCalendar());

      // Fail-closed: when signing was requested but cannot be performed, we
      // must not send an unsigned GET (which signature-requiring peers
      // would reject anyway).
      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
    });

    it('returns null and skips the HTTP request when signing throws', async () => {
      sandbox.stub(CalendarActorService.prototype, 'getActorByCalendarId').resolves({
        id: 'actor-id-123',
        calendarId: SIGNING_CALENDAR_ID,
        actorUri: SIGNING_ACTOR_URI,
        publicKey: 'PUBLIC_KEY_PEM',
        privateKey: 'PRIVATE_KEY_PEM',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      sandbox.stub(CalendarActorService.prototype, 'signActivity').rejects(new Error('no private key'));

      const result = await fetchRemoteObject(TARGET_URI, makeSigningCalendar());

      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
    });

    it('does NOT attach signature headers when no signing calendar is provided', async () => {
      // Stub signing primitives so a leak through to them would still be
      // observable; assert they are never called.
      const actorStub = sandbox.stub(CalendarActorService.prototype, 'getActorByCalendarId');
      const signStub = sandbox.stub(CalendarActorService.prototype, 'signActivity');
      axiosGetStub.resolves({ status: 200, data: { type: 'Event' } });

      await fetchRemoteObject(TARGET_URI);

      const callArgs = axiosGetStub.firstCall.args[1];
      expect(callArgs.headers.Signature).toBeUndefined();
      expect(callArgs.headers.Date).toBeUndefined();
      // Existing Accept/User-Agent headers are still present.
      expect(callArgs.headers['Accept']).toBe('application/activity+json');
      expect(callArgs.headers['User-Agent']).toBe('Pavillion ActivityPub Server');
      // Signing primitives must not be invoked in the unsigned path.
      expect(actorStub.called).toBe(false);
      expect(signStub.called).toBe(false);
    });
  });
});
