import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import httpSignature from 'http-signature';
import axios from 'axios';
import sinon from 'sinon';
import { Cache } from '@/server/activitypub/helper/cache';
import { verifyHttpSignature } from '@/server/activitypub/helper/http_signature';
import crypto from 'crypto';

describe('HTTP Signature Verification', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: sinon.SinonSpy;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  // Create stubs that we'll configure in each test
  let parseRequestStub: sinon.SinonStub;
  let verifySignatureStub: sinon.SinonStub;
  let axiosGetStub: sinon.SinonStub;
  let cacheGetStub: sinon.SinonStub;
  let cacheSetStub: sinon.SinonStub;

  // Store original environment variables
  let originalNodeEnv: string | undefined;
  let originalSkipSignatures: string | undefined;

  beforeEach(() => {
    // Store original environment variables
    originalNodeEnv = process.env.NODE_ENV;
    originalSkipSignatures = process.env.SKIP_SIGNATURES;

    // Set up request and response objects
    req = {
      headers: {
        'date': new Date().toUTCString(),
        'host': 'example.com',
      },
      body: { actor: 'https://example.com/users/someactor' },
    };

    res = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub().returnsThis(),
    };

    next = sandbox.spy();

    // Set up stubs for dependencies
    parseRequestStub = sandbox.stub(httpSignature, 'parseRequest');
    verifySignatureStub = sandbox.stub(httpSignature, 'verifySignature');
    axiosGetStub = sandbox.stub(axios, 'get');

    // Set up stub for Cache class
    cacheGetStub = sandbox.stub(Cache.prototype, 'get');
    cacheSetStub = sandbox.stub(Cache.prototype, 'set');
  });

  afterEach(() => {
    // Restore all stubs and spies
    sandbox.restore();

    // Restore original environment variables
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }

    if (originalSkipSignatures !== undefined) {
      process.env.SKIP_SIGNATURES = originalSkipSignatures;
    } else {
      delete process.env.SKIP_SIGNATURES;
    }
  });

  it('should reject requests without a signature', async () => {
    // Configure parseRequest to return null (no signature)
    parseRequestStub.returns(null);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(res.status.calledWith(401)).toBe(true);
    expect(res.json.calledWith({ error: 'Signature required' })).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should reject requests with missing signature parameters', async () => {
    // Configure parseRequest to return object with empty params
    parseRequestStub.returns({
      params: {},
    } as any);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(res.status.calledWith(401)).toBe(true);
    expect(res.json.calledWith({ error: 'Invalid signature format - missing required parameters' })).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should reject requests with missing required headers in signature', async () => {
    // Configure parseRequest to return object with missing required headers
    parseRequestStub.returns({
      params: {
        keyId: 'https://example.com/users/someactor#main-key',
        signature: 'validSignature',
        headers: ['(request-target)', 'host'], // missing 'date'
      },
    } as any);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(res.status.calledWith(401)).toBe(true);
    expect(res.json.calledWith({ error: 'Invalid signature format - missing required headers in signature' })).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should reject requests with stale date headers', async () => {
    // Set date header to 1 minute in the past
    req.headers.date = new Date(Date.now() - 60000).toUTCString();

    parseRequestStub.returns({
      params: {
        keyId: 'https://example.com/users/someactor#main-key',
        signature: 'validSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(res.status.calledWith(401)).toBe(true);
    expect(res.json.calledWith({ error: 'Request date is too old or in the future' })).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should reject requests with invalid digest', async () => {
    // Add digest header
    req.headers.digest = 'SHA-256=invalidHash';

    parseRequestStub.returns({
      params: {
        keyId: 'https://example.com/users/someactor#main-key',
        signature: 'validSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    // Spy on crypto.createHash
    const hashStub = sandbox.stub(crypto, 'createHash');
    const mockDigest = {
      update: sandbox.stub().returnsThis(),
      digest: sandbox.stub().returns('differentHash'),
    };
    hashStub.returns(mockDigest as any);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(hashStub.calledWith('sha256')).toBe(true);
    expect(mockDigest.update.calledWith(JSON.stringify(req.body))).toBe(true);
    expect(res.status.calledWith(401)).toBe(true);
    expect(res.json.calledWith({ error: 'Invalid digest' })).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should reject requests with unsupported digest algorithm', async () => {
    // Add digest header with unsupported algorithm
    req.headers.digest = 'MD5=someHash';

    parseRequestStub.returns({
      params: {
        keyId: 'https://example.com/users/someactor#main-key',
        signature: 'validSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(res.status.calledWith(401)).toBe(true);
    expect(res.json.calledWith({ error: 'Unsupported digest algorithm' })).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should reject requests with malformed digest header', async () => {
    // Add malformed digest header
    req.headers.digest = 'malformed-digest';

    parseRequestStub.returns({
      params: {
        keyId: 'https://example.com/users/someactor#main-key',
        signature: 'validSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(res.status.calledWith(401)).toBe(true);
    expect(res.json.calledWith({ error: 'Invalid digest' })).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should reject when public key cannot be retrieved', async () => {
    parseRequestStub.returns({
      params: {
        keyId: 'https://example.com/users/someactor#main-key',
        signature: 'validSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    // Configure axios.get to simulate failure to get public key
    axiosGetStub.rejects(new Error('Failed to fetch'));

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(axiosGetStub.calledWith('https://example.com/users/someactor', sinon.match.any)).toBe(true);
    expect(res.status.calledWith(401)).toBe(true);
    expect(res.json.calledWith({ error: 'Could not retrieve public key' })).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should reject when signature verification fails', async () => {
    parseRequestStub.returns({
      params: {
        keyId: 'https://example.com/users/someactor#main-key',
        signature: 'invalidSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    // Configure successful public key retrieval
    axiosGetStub.resolves({
      status: 200,
      data: {
        publicKey: {
          publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Rdj53hR\n-----END PUBLIC KEY-----',
        },
      },
    });

    // Configure signature verification failure
    verifySignatureStub.returns(false);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(verifySignatureStub.calledWith(sinon.match.any, sinon.match.string)).toBe(true);
    expect(res.status.calledWith(401)).toBe(true);
    expect(res.json.calledWith({ error: 'Invalid signature' })).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should reject when actor does not match key', async () => {
    // Body with actor from a different domain
    req.body = { actor: 'https://differentdomain.com/users/someactor' };

    parseRequestStub.returns({
      params: {
        keyId: 'https://example.com/users/someactor#main-key',
        signature: 'validSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    // Configure successful public key retrieval
    axiosGetStub.resolves({
      status: 200,
      data: {
        publicKey: {
          publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Rdj53hR\n-----END PUBLIC KEY-----',
        },
      },
    });

    // Configure successful signature verification
    verifySignatureStub.returns(true);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(res.status.calledWith(403)).toBe(true);
    expect(res.json.calledWith({ error: 'Actor does not have permission for this operation' })).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should call next() when signature is valid', async () => {
    req.body = { actor: 'https://example.com/users/someactor' };

    parseRequestStub.returns({
      params: {
        keyId: 'https://example.com/users/someactor#main-key',
        signature: 'validSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    // Configure successful public key retrieval
    axiosGetStub.resolves({
      status: 200,
      data: {
        publicKey: {
          publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Rdj53hR\n-----END PUBLIC KEY-----',
        },
      },
    });

    // Configure successful signature verification
    verifySignatureStub.returns(true);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(cacheSetStub.called).toBe(true);
    expect(next.called).toBe(true);
    expect(res.status.called).toBe(false);
  });

  it('should use cached public key if available', async () => {
    parseRequestStub.returns({
      params: {
        keyId: 'https://example.com/users/someactor#main-key',
        signature: 'validSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    // Configure Cache stub to return a key
    const cachedKey = '-----BEGIN PUBLIC KEY-----\nCACHED_KEY\n-----END PUBLIC KEY-----';
    cacheGetStub.returns(cachedKey);

    // Configure successful signature verification
    verifySignatureStub.returns(true);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    // Axios should not be called if cache hit
    expect(axiosGetStub.called).toBe(false);
    expect(next.called).toBe(true);
  });

  it('should handle alternative public key structure', async () => {
    parseRequestStub.returns({
      params: {
        keyId: 'https://example.com/users/someactor#main-key',
        signature: 'validSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    // Configure first response with URL to key
    axiosGetStub.onFirstCall().resolves({
      status: 200,
      data: {
        publicKey: 'https://example.com/users/someactor/key',
      },
    });

    // Configure second response with actual key
    axiosGetStub.onSecondCall().resolves({
      status: 200,
      data: {
        publicKeyPem: '-----BEGIN PUBLIC KEY-----\nALTERNATIVE_KEY\n-----END PUBLIC KEY-----',
      },
    });

    // Configure successful signature verification
    verifySignatureStub.returns(true);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(axiosGetStub.callCount).toBe(2);
    expect(next.called).toBe(true);
  });

  it('should handle errors gracefully', async () => {
    // Configure parseRequest to throw an error
    parseRequestStub.throws(new Error('Unexpected error'));

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(res.status.calledWith(500)).toBe(true);
    expect(res.json.calledWith({ error: 'Error verifying HTTP signature' })).toBe(true);
    expect(next.called).toBe(false);
  });

  describe('Production Environment Security Checks', () => {
    it('should throw error when SKIP_SIGNATURES is true in production', async () => {
      // Set production environment
      process.env.NODE_ENV = 'production';
      process.env.SKIP_SIGNATURES = 'true';

      // Verify that calling verifyHttpSignature throws an error
      await expect(async () => {
        await verifyHttpSignature(req as Request, res as Response, next as any);
      }).rejects.toThrow('CRITICAL SECURITY ERROR: HTTP signature verification cannot be disabled in production');

      // Verify next was never called
      expect(next.called).toBe(false);
    });

    it('should allow SKIP_SIGNATURES in non-production environments', async () => {
      // Set development environment
      process.env.NODE_ENV = 'development';
      process.env.SKIP_SIGNATURES = 'true';

      // Should not throw and should call next()
      await verifyHttpSignature(req as Request, res as Response, next as any);

      expect(next.called).toBe(true);
      expect(res.status.called).toBe(false);
    });

    it('should allow signature verification in production when skip is false', async () => {
      // Set production environment without skip
      process.env.NODE_ENV = 'production';
      delete process.env.SKIP_SIGNATURES;

      parseRequestStub.returns({
        params: {
          keyId: 'https://example.com/users/someactor#main-key',
          signature: 'validSignature',
          headers: ['(request-target)', 'host', 'date'],
        },
      } as any);

      // Configure successful public key retrieval
      axiosGetStub.resolves({
        status: 200,
        data: {
          publicKey: {
            publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Rdj53hR\n-----END PUBLIC KEY-----',
          },
        },
      });

      // Configure successful signature verification
      verifySignatureStub.returns(true);

      // Should work normally in production when skip is false
      await verifyHttpSignature(req as Request, res as Response, next as any);

      expect(next.called).toBe(true);
      expect(res.status.called).toBe(false);
    });

    it('should throw error when SKIP_SIGNATURES is false but config skipSignatures is true in production', async () => {
      // Set production environment
      process.env.NODE_ENV = 'production';
      delete process.env.SKIP_SIGNATURES;

      // Mock config to return true for skipSignatures
      const configHasStub = sandbox.stub(require('config'), 'has');
      const configGetStub = sandbox.stub(require('config'), 'get');
      configHasStub.withArgs('federation.skipSignatures').returns(true);
      configGetStub.withArgs('federation.skipSignatures').returns('true');

      // Verify that calling verifyHttpSignature throws an error
      await expect(async () => {
        await verifyHttpSignature(req as Request, res as Response, next as any);
      }).rejects.toThrow('CRITICAL SECURITY ERROR: HTTP signature verification cannot be disabled in production');

      // Verify next was never called
      expect(next.called).toBe(false);
    });
  });
});
