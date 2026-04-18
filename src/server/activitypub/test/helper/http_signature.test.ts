import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import httpSignature from 'http-signature';
import axios from 'axios';
import sinon from 'sinon';
import { Cache } from '@/server/activitypub/helper/cache';
import { verifyHttpSignature } from '@/server/activitypub/helper/http_signature';
import { MAX_REQUEST_AGE_MS } from '@/server/common/constants';
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
    }
    else {
      delete process.env.NODE_ENV;
    }

    if (originalSkipSignatures !== undefined) {
      process.env.SKIP_SIGNATURES = originalSkipSignatures;
    }
    else {
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
    // Set date header beyond the freshness window
    req.headers.date = new Date(Date.now() - MAX_REQUEST_AGE_MS - 60000).toUTCString();

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

  it('should reject when actor URL fetch throws a 302 redirect AxiosError', async () => {
    parseRequestStub.returns({
      params: {
        keyId: 'https://example.com/users/someactor#main-key',
        signature: 'validSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    // Simulate axios throwing when it encounters a redirect (maxRedirects: 0)
    const redirectError = new Error('Redirect');
    (redirectError as any).response = { status: 302 };
    (redirectError as any).isAxiosError = true;
    axiosGetStub.rejects(redirectError);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(axiosGetStub.calledWith('https://example.com/users/someactor', sinon.match.any)).toBe(true);
    expect(res.status.calledWith(401)).toBe(true);
    expect(res.json.calledWith({ error: 'Could not retrieve public key' })).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should reject when keyId is not a valid URL', async () => {
    parseRequestStub.returns({
      params: {
        keyId: 'not-a-valid-url',
        signature: 'validSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(axiosGetStub.called).toBe(false);
    expect(res.status.calledWith(401)).toBe(true);
    expect(res.json.calledWith({ error: 'Could not retrieve public key' })).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should reject when keyId is an empty string', async () => {
    parseRequestStub.returns({
      params: {
        keyId: '',
        signature: 'validSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(axiosGetStub.called).toBe(false);
    expect(res.status.calledWith(401)).toBe(true);
    expect(res.json.calledWith({ error: 'Invalid signature format - missing required parameters' })).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should reject when keyId contains only whitespace', async () => {
    parseRequestStub.returns({
      params: {
        keyId: '   ',
        signature: 'validSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(axiosGetStub.called).toBe(false);
    expect(res.status.calledWith(401)).toBe(true);
    expect(res.json.calledWith({ error: 'Could not retrieve public key' })).toBe(true);
    expect(next.called).toBe(false);
  });

  it('should reject when keyId is a malformed URL with special characters', async () => {
    parseRequestStub.returns({
      params: {
        keyId: 'http://<script>alert("xss")</script>',
        signature: 'validSignature',
        headers: ['(request-target)', 'host', 'date'],
      },
    } as any);

    await verifyHttpSignature(req as Request, res as Response, next as any);

    expect(axiosGetStub.called).toBe(false);
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

  it('should reject when actor URL attempts startsWith bypass', async () => {
    // Test for security vulnerability: actor URL that starts with legitimate actor but has extra characters
    // This should be rejected with the fix (using exact match instead of startsWith)
    req.body = { actor: 'https://example.com/users/someactor-fake' };

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

    // Should reject because actor does not exactly match
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

  describe('SSRF Protection - Private IP Blocking', () => {
    it('should reject keyId with private IPv4 address (10.0.0.0/8)', async () => {
      parseRequestStub.returns({
        params: {
          keyId: 'http://10.0.0.1/users/someactor#main-key',
          signature: 'validSignature',
          headers: ['(request-target)', 'host', 'date'],
        },
      } as any);

      await verifyHttpSignature(req as Request, res as Response, next as any);

      // Should reject without making any network requests
      expect(axiosGetStub.called).toBe(false);
      expect(res.status.calledWith(401)).toBe(true);
      expect(res.json.calledWith({ error: 'Could not retrieve public key' })).toBe(true);
      expect(next.called).toBe(false);
    });

    it('should reject keyId with private IPv4 address (192.168.0.0/16)', async () => {
      parseRequestStub.returns({
        params: {
          keyId: 'http://192.168.1.1/users/someactor#main-key',
          signature: 'validSignature',
          headers: ['(request-target)', 'host', 'date'],
        },
      } as any);

      await verifyHttpSignature(req as Request, res as Response, next as any);

      expect(axiosGetStub.called).toBe(false);
      expect(res.status.calledWith(401)).toBe(true);
      expect(res.json.calledWith({ error: 'Could not retrieve public key' })).toBe(true);
      expect(next.called).toBe(false);
    });

    it('should reject keyId with loopback address (127.0.0.1)', async () => {
      parseRequestStub.returns({
        params: {
          keyId: 'http://127.0.0.1:3000/users/someactor#main-key',
          signature: 'validSignature',
          headers: ['(request-target)', 'host', 'date'],
        },
      } as any);

      await verifyHttpSignature(req as Request, res as Response, next as any);

      expect(axiosGetStub.called).toBe(false);
      expect(res.status.calledWith(401)).toBe(true);
      expect(res.json.calledWith({ error: 'Could not retrieve public key' })).toBe(true);
      expect(next.called).toBe(false);
    });

    it('should reject keyId with link-local address (169.254.169.254 - AWS metadata)', async () => {
      parseRequestStub.returns({
        params: {
          keyId: 'http://169.254.169.254/latest/meta-data',
          signature: 'validSignature',
          headers: ['(request-target)', 'host', 'date'],
        },
      } as any);

      await verifyHttpSignature(req as Request, res as Response, next as any);

      expect(axiosGetStub.called).toBe(false);
      expect(res.status.calledWith(401)).toBe(true);
      expect(res.json.calledWith({ error: 'Could not retrieve public key' })).toBe(true);
      expect(next.called).toBe(false);
    });

    it('should reject keyId with private IPv6 address (::1)', async () => {
      parseRequestStub.returns({
        params: {
          keyId: 'http://[::1]/users/someactor#main-key',
          signature: 'validSignature',
          headers: ['(request-target)', 'host', 'date'],
        },
      } as any);

      await verifyHttpSignature(req as Request, res as Response, next as any);

      expect(axiosGetStub.called).toBe(false);
      expect(res.status.calledWith(401)).toBe(true);
      expect(res.json.calledWith({ error: 'Could not retrieve public key' })).toBe(true);
      expect(next.called).toBe(false);
    });

    it('should reject keyId with IPv6 link-local address (fe80::)', async () => {
      parseRequestStub.returns({
        params: {
          keyId: 'http://[fe80::1]/users/someactor#main-key',
          signature: 'validSignature',
          headers: ['(request-target)', 'host', 'date'],
        },
      } as any);

      await verifyHttpSignature(req as Request, res as Response, next as any);

      expect(axiosGetStub.called).toBe(false);
      expect(res.status.calledWith(401)).toBe(true);
      expect(res.json.calledWith({ error: 'Could not retrieve public key' })).toBe(true);
      expect(next.called).toBe(false);
    });

    it('should reject when publicKey URL in actor object points to private IP', async () => {
      parseRequestStub.returns({
        params: {
          keyId: 'https://example.com/users/someactor#main-key',
          signature: 'validSignature',
          headers: ['(request-target)', 'host', 'date'],
        },
      } as any);

      // First call returns actor object with private IP for publicKey
      axiosGetStub.onFirstCall().resolves({
        status: 200,
        data: {
          publicKey: 'http://192.168.1.1/key', // Private IP in publicKey URL
        },
      });

      await verifyHttpSignature(req as Request, res as Response, next as any);

      // Should make first call but reject before second call
      expect(axiosGetStub.callCount).toBe(1);
      expect(res.status.calledWith(401)).toBe(true);
      expect(res.json.calledWith({ error: 'Could not retrieve public key' })).toBe(true);
      expect(next.called).toBe(false);
    });

    it('should allow keyId with public IP address', async () => {
      // Update request body to match the keyId domain
      req.body = { actor: 'https://8.8.8.8/users/someactor' };

      parseRequestStub.returns({
        params: {
          keyId: 'https://8.8.8.8/users/someactor#main-key',
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

      expect(axiosGetStub.called).toBe(true);
      expect(next.called).toBe(true);
    });
  });
});

/**
 * End-to-end cryptographic round-trip for HTTP Signatures.
 *
 * Bead context: pv-dyyw.3.1 retry. The federation e2e spec
 * (signed_delivery.spec.ts) proves the OUTBOUND delivery pipeline runs under
 * signing, but the receive-side gate is short-circuited by SKIP_SIGNATURES on
 * the local Docker harness, so the e2e cannot distinguish a correctly-signed
 * POST from a forged one. These unit tests close that gap by exercising the
 * full sign-then-verify loop with real RSA crypto:
 *
 *   1. Generate an in-test RSA-2048 keypair.
 *   2. Use the real `buildSignedHeaders` helper from http-signing.ts, with the
 *      actor services stubbed so signing resolves to the test private key.
 *   3. Feed the signed request to the real `verifyHttpSignature` middleware
 *      with SKIP_SIGNATURES off and the public-key cache primed with the
 *      matching public key (no network round-trip required).
 *   4. Assert next() is called for a clean signature.
 *   5. Assert 401 is returned when the body is tampered after signing
 *      (digest mismatch) — proves rejection works.
 *
 * The verifier is activity-type agnostic, so a single positive + single
 * negative case is sufficient cryptographic proof for all four signed
 * activity types (Create / Update / Delete / Add).
 */
describe('HTTP Signature Cryptographic Round-Trip', () => {
  let sandbox: sinon.SinonSandbox;
  let originalNodeEnv: string | undefined;
  let originalSkipSignatures: string | undefined;

  // RSA keypair generated once per test for cryptographic isolation
  let privateKeyPem: string;
  let publicKeyPem: string;

  const ACTOR_URI = 'https://alpha.federation.local/o/roundtrip-cal';
  const TARGET_URL = 'https://beta.federation.local/o/roundtrip-cal/inbox';

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    originalNodeEnv = process.env.NODE_ENV;
    originalSkipSignatures = process.env.SKIP_SIGNATURES;

    // Force the verifier into enforce mode regardless of how the test process
    // was launched. Without this, a CI runner exporting SKIP_SIGNATURES=true
    // would let the round-trip test pass vacuously.
    process.env.NODE_ENV = 'test';
    delete process.env.SKIP_SIGNATURES;

    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKeyPem = privateKey;
    publicKeyPem = publicKey;
  });

  afterEach(() => {
    sandbox.restore();

    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    }
    else {
      delete process.env.NODE_ENV;
    }

    if (originalSkipSignatures !== undefined) {
      process.env.SKIP_SIGNATURES = originalSkipSignatures;
    }
    else {
      delete process.env.SKIP_SIGNATURES;
    }
  });

  /**
   * Build a fake CalendarActorService that succeeds at signActivity using the
   * in-test keypair. UserActorService is stubbed to throw so the
   * buildSignedHeaders helper resolves on the calendar branch (matches the
   * normal calendar-actor delivery path).
   */
  function buildActorServices(): { calendarActorService: any; userActorService: any } {
    const calendarActorService = {
      signActivity: async (
        actorUri: string,
        _activity: any,
        targetUrl: string,
        digest?: string,
      ) => {
        const url = new URL(targetUrl);
        const host = url.host;
        const path = url.pathname + url.search;
        const date = new Date().toUTCString();

        const signingStringParts = [
          `(request-target): post ${path}`,
          `host: ${host}`,
          `date: ${date}`,
        ];
        if (digest) {
          signingStringParts.push(`digest: ${digest}`);
        }
        const signingString = signingStringParts.join('\n');

        const signer = crypto.createSign('RSA-SHA256');
        signer.update(signingString);
        signer.end();
        const signature = signer.sign(privateKeyPem).toString('base64');

        return {
          keyId: `${actorUri}#main-key`,
          signature,
          algorithm: 'rsa-sha256',
          headers: digest ? '(request-target) host date digest' : '(request-target) host date',
          date,
        };
      },
    };

    const userActorService = {
      signActivity: async () => {
        throw new Error('user actor signing not used in this test');
      },
    };

    return { calendarActorService, userActorService };
  }

  /**
   * Construct the Express request that mirrors what an inbound POST looks like
   * after Express has parsed headers and body. http-signature's parseRequest
   * needs `method`, `url`, and `httpVersion` in addition to `headers`.
   */
  function buildIncomingRequest(
    targetUrl: string,
    actorUri: string,
    body: any,
    signedHeaders: { Signature: string; Date: string; Digest: string },
  ): Request {
    const url = new URL(targetUrl);
    return {
      method: 'POST',
      url: url.pathname + url.search,
      httpVersion: '1.1',
      headers: {
        host: url.host,
        date: signedHeaders.Date,
        digest: signedHeaders.Digest,
        signature: signedHeaders.Signature,
        'content-type': 'application/activity+json',
      },
      body,
    } as unknown as Request;
  }

  it('accepts a request signed by buildSignedHeaders end-to-end', async () => {
    const { buildSignedHeaders } = await import('@/server/activitypub/service/http-signing');

    const activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Create',
      actor: ACTOR_URI,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      object: {
        type: 'Event',
        id: 'https://alpha.federation.local/o/roundtrip-cal/events/abc',
        name: 'Round-trip test event',
      },
    };
    const body = JSON.stringify(activity);
    const digest = 'SHA-256=' + crypto.createHash('sha256').update(body).digest('base64');

    const { calendarActorService, userActorService } = buildActorServices();

    const signed = await buildSignedHeaders(
      ACTOR_URI,
      body,
      TARGET_URL,
      digest,
      calendarActorService as any,
      userActorService as any,
    );
    expect(signed, 'buildSignedHeaders must produce headers for a valid actor').not.toBeNull();

    // Prime the public-key cache so verifyHttpSignature does NOT try to
    // resolve over the network. This isolates the test from axios entirely.
    const cacheGetStub = sandbox.stub(Cache.prototype, 'get').returns(publicKeyPem);
    sandbox.stub(Cache.prototype, 'set');
    const axiosGetStub = sandbox.stub(axios, 'get');

    // Body is parsed back to an object because Express body-parser delivers
    // it that way to the inbox handler. The verifier re-stringifies via
    // JSON.stringify(req.body) for digest comparison, so the structural shape
    // (and key order) must match what we hashed above. JSON.parse/stringify
    // round-trip preserves key order for plain objects in V8.
    const incomingReq = buildIncomingRequest(TARGET_URL, ACTOR_URI, JSON.parse(body), signed!);
    const res: any = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub().returnsThis(),
    };
    const next = sandbox.spy();

    await verifyHttpSignature(incomingReq, res as Response, next as any);

    expect(
      next.called,
      'verifyHttpSignature must call next() for a request signed end-to-end with the matching keypair',
    ).toBe(true);
    expect(res.status.called, 'no error status should be emitted').toBe(false);
    expect(cacheGetStub.calledWith(`${ACTOR_URI}#main-key`)).toBe(true);
    expect(axiosGetStub.called, 'no network fetch should be needed when cache is primed').toBe(false);
  });

  it('rejects a request whose body is tampered after signing (digest mismatch)', async () => {
    const { buildSignedHeaders } = await import('@/server/activitypub/service/http-signing');

    const activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Create',
      actor: ACTOR_URI,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      object: {
        type: 'Event',
        id: 'https://alpha.federation.local/o/roundtrip-cal/events/abc',
        name: 'Round-trip test event',
      },
    };
    const body = JSON.stringify(activity);
    const digest = 'SHA-256=' + crypto.createHash('sha256').update(body).digest('base64');

    const { calendarActorService, userActorService } = buildActorServices();

    const signed = await buildSignedHeaders(
      ACTOR_URI,
      body,
      TARGET_URL,
      digest,
      calendarActorService as any,
      userActorService as any,
    );
    expect(signed).not.toBeNull();

    sandbox.stub(Cache.prototype, 'get').returns(publicKeyPem);
    sandbox.stub(Cache.prototype, 'set');
    sandbox.stub(axios, 'get');

    // Mutate the body AFTER signing. The Signature and Digest headers still
    // refer to the original body. The verifier hashes the tampered body and
    // compares against the original digest -- mismatch must trigger 401.
    const tamperedBody = { ...JSON.parse(body), object: { ...activity.object, name: 'Malicious payload' } };

    const incomingReq = buildIncomingRequest(TARGET_URL, ACTOR_URI, tamperedBody, signed!);
    const res: any = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub().returnsThis(),
    };
    const next = sandbox.spy();

    await verifyHttpSignature(incomingReq, res as Response, next as any);

    expect(
      res.status.calledWith(401),
      'tampering with the body after signing must cause a 401 Invalid digest response',
    ).toBe(true);
    expect(res.json.calledWith({ error: 'Invalid digest' })).toBe(true);
    expect(next.called, 'next() must NOT be invoked when the digest fails').toBe(false);
  });
});
