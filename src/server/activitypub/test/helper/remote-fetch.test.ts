import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import sinon from 'sinon';
import { fetchRemoteObject } from '@/server/activitypub/helper/remote-fetch';
import { REMOTE_OBJECT_FETCH_TIMEOUT_MS } from '@/server/activitypub/constants';

describe('fetchRemoteObject', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let axiosGetStub: sinon.SinonStub;
  let consoleErrorStub: sinon.SinonStub;

  beforeEach(() => {
    axiosGetStub = sandbox.stub(axios, 'get');
    consoleErrorStub = sandbox.stub(console, 'error');
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

  it('should return null when HTTP response is not 200', async () => {
    axiosGetStub.resolves({
      status: 404,
      data: null,
    });

    const result = await fetchRemoteObject('https://remote.example/events/notfound');

    expect(result).toBeNull();
    expect(consoleErrorStub.calledOnce).toBe(true);
  });

  it('should return null on network error', async () => {
    const networkError = new Error('Network Error');
    (networkError as any).request = {};
    (networkError as any).isAxiosError = true;
    sandbox.stub(axios, 'isAxiosError').returns(true);
    axiosGetStub.rejects(networkError);

    const result = await fetchRemoteObject('https://unreachable.example/events/123');

    expect(result).toBeNull();
    expect(consoleErrorStub.called).toBe(true);
  });

  it('should return null on timeout', async () => {
    const timeoutError = new Error('timeout of 5000ms exceeded');
    (timeoutError as any).code = 'ECONNABORTED';
    (timeoutError as any).isAxiosError = true;
    sandbox.stub(axios, 'isAxiosError').returns(true);
    axiosGetStub.rejects(timeoutError);

    const result = await fetchRemoteObject('https://slow.example/events/123');

    expect(result).toBeNull();
    expect(consoleErrorStub.called).toBe(true);
  });

  it('should return null on HTTP error response', async () => {
    const httpError = new Error('Request failed with status code 500');
    (httpError as any).response = { status: 500 };
    (httpError as any).isAxiosError = true;
    sandbox.stub(axios, 'isAxiosError').returns(true);
    axiosGetStub.rejects(httpError);

    const result = await fetchRemoteObject('https://remote.example/events/error');

    expect(result).toBeNull();
    expect(consoleErrorStub.called).toBe(true);
  });

  it('should return null on unexpected error', async () => {
    const unexpectedError = new Error('Unexpected error');
    sandbox.stub(axios, 'isAxiosError').returns(false);
    axiosGetStub.rejects(unexpectedError);

    const result = await fetchRemoteObject('https://remote.example/events/123');

    expect(result).toBeNull();
    expect(consoleErrorStub.called).toBe(true);
  });

  it('should handle axios error without response or request', async () => {
    const axiosError = new Error('Unknown axios error');
    (axiosError as any).isAxiosError = true;
    sandbox.stub(axios, 'isAxiosError').returns(true);
    axiosGetStub.rejects(axiosError);

    const result = await fetchRemoteObject('https://remote.example/events/123');

    expect(result).toBeNull();
    expect(consoleErrorStub.called).toBe(true);
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
      expect(consoleErrorStub.called).toBe(true);
    });

    it('should reject URI with private IPv4 address (192.168.0.0/16)', async () => {
      const result = await fetchRemoteObject('http://192.168.1.1/events/123');

      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
      expect(consoleErrorStub.called).toBe(true);
    });

    it('should reject URI with loopback address (127.0.0.1)', async () => {
      const result = await fetchRemoteObject('http://127.0.0.1:3000/events/123');

      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
      expect(consoleErrorStub.called).toBe(true);
    });

    it('should reject URI with link-local address (169.254.169.254 - AWS metadata)', async () => {
      const result = await fetchRemoteObject('http://169.254.169.254/latest/meta-data');

      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
      expect(consoleErrorStub.called).toBe(true);
    });

    it('should reject URI with private IPv6 address (::1)', async () => {
      const result = await fetchRemoteObject('http://[::1]/events/123');

      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
      expect(consoleErrorStub.called).toBe(true);
    });

    it('should reject URI with IPv6 link-local address (fe80::)', async () => {
      const result = await fetchRemoteObject('http://[fe80::1]/events/123');

      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
      expect(consoleErrorStub.called).toBe(true);
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
});
