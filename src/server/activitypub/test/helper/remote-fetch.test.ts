import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// SSRF validation resolves hostnames through dns.lookup. Mocking it keeps
// these tests off the network and lets the rebinding test answer differently
// on successive resolutions. vi.mock is hoisted, so ip-validation captures
// the mock when it promisifies dns.lookup at load time.
vi.mock('dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dns') & { default: typeof import('dns') }>();
  return { ...actual, default: { ...actual.default, lookup: vi.fn() } };
});

import dns from 'dns';
import https from 'https';
import axios from 'axios';
import sinon from 'sinon';
import { fetchRemoteObject } from '@/server/activitypub/helper/remote-fetch';
import { REMOTE_OBJECT_FETCH_TIMEOUT_MS, REMOTE_OBJECT_MAX_BYTES } from '@/server/common/constants';
import { mockDnsLookup, pinnedAddressOf, PUBLIC_IP, PRIVATE_IP } from '@/server/activitypub/test/helper/pinned-dns';

describe('fetchRemoteObject', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let axiosGetStub: sinon.SinonStub;

  beforeEach(() => {
    axiosGetStub = sandbox.stub(axios, 'get');
    mockDnsLookup(vi.mocked(dns.lookup), [PUBLIC_IP]);
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

  describe('response-body byte cap', () => {
    /**
     * Mimics axios's own enforcement: reject with the ERR_BAD_RESPONSE
     * AxiosError axios raises when the body exceeds `config.maxContentLength`,
     * otherwise resolve. Lets the tests assert the cap actually reaches the
     * client rather than only that a number was put on the config object.
     */
    function stubAxiosEnforcingCap(bodyBytes: number) {
      axiosGetStub.callsFake(async (_uri: string, config: { maxContentLength?: number }) => {
        if (config.maxContentLength !== undefined && config.maxContentLength !== -1 && bodyBytes > config.maxContentLength) {
          const err = new Error(`maxContentLength size of ${config.maxContentLength} exceeded`);
          (err as any).code = 'ERR_BAD_RESPONSE';
          (err as any).isAxiosError = true;
          throw err;
        }
        return { status: 200, data: { type: 'Event' } };
      });
      sandbox.stub(axios, 'isAxiosError').returns(true);
    }

    it('bounds the response body by default when no option is passed', async () => {
      stubAxiosEnforcingCap(REMOTE_OBJECT_MAX_BYTES + 1);

      const result = await fetchRemoteObject('https://remote.example/events/huge');

      expect(result).toBeNull();
      expect(axiosGetStub.firstCall.args[1].maxContentLength).toBe(REMOTE_OBJECT_MAX_BYTES);
    });

    it('accepts a body within the default cap when no option is passed', async () => {
      stubAxiosEnforcingCap(REMOTE_OBJECT_MAX_BYTES);

      const result = await fetchRemoteObject('https://remote.example/events/123');

      expect(result).toEqual({ type: 'Event' });
    });

    it('lets an explicit maxContentLength override the default', async () => {
      const explicitCap = REMOTE_OBJECT_MAX_BYTES * 4;
      stubAxiosEnforcingCap(REMOTE_OBJECT_MAX_BYTES + 1);

      const result = await fetchRemoteObject(
        'https://remote.example/outbox?page=true',
        undefined,
        { maxContentLength: explicitCap },
      );

      expect(result).toEqual({ type: 'Event' });
      expect(axiosGetStub.firstCall.args[1].maxContentLength).toBe(explicitCap);
    });

    it('lets an explicit maxContentLength tighten the default', async () => {
      stubAxiosEnforcingCap(1024);

      const result = await fetchRemoteObject(
        'https://remote.example/events/123',
        undefined,
        { maxContentLength: 512 },
      );

      expect(result).toBeNull();
      expect(axiosGetStub.firstCall.args[1].maxContentLength).toBe(512);
    });
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
      expect(await pinnedAddressOf(axiosGetStub.firstCall.args[1].httpsAgent)).toBe('8.8.8.8');
    });
  });

  describe('connection pinning (DNS rebinding)', () => {
    it('connects to the address that passed validation, not a second resolution', async () => {
      // First resolution is public, every later one private: a rebinding name.
      const lookup = mockDnsLookup(vi.mocked(dns.lookup), [PUBLIC_IP, PRIVATE_IP]);
      axiosGetStub.resolves({ status: 200, data: { type: 'Note' } });

      const result = await fetchRemoteObject('https://rebind.example/notes/1');

      expect(result).not.toBeNull();
      const agent = axiosGetStub.firstCall.args[1].httpsAgent;
      expect(agent).toBeInstanceOf(https.Agent);
      expect(await pinnedAddressOf(agent)).toBe(PUBLIC_IP);
      // The pinned agent answers without consulting DNS again, even though a
      // fresh resolution of the name would now return the private address.
      expect(lookup.resolutions()).toBe(1);
    });

    it('pins with the remote-object fetch timeout', async () => {
      axiosGetStub.resolves({ status: 200, data: { type: 'Note' } });

      await fetchRemoteObject('https://remote.example/notes/1');

      expect(axiosGetStub.firstCall.args[1].httpsAgent.options.timeout).toBe(REMOTE_OBJECT_FETCH_TIMEOUT_MS);
    });

    it('refuses to fetch a hostname that does not resolve', async () => {
      mockDnsLookup(vi.mocked(dns.lookup), []);

      const result = await fetchRemoteObject('https://nowhere.example/notes/1');

      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
    });

    it('refuses to fetch a hostname whose first resolution is private', async () => {
      mockDnsLookup(vi.mocked(dns.lookup), [PRIVATE_IP]);

      const result = await fetchRemoteObject('https://internal.example/notes/1');

      expect(result).toBeNull();
      expect(axiosGetStub.called).toBe(false);
    });
  });
});
