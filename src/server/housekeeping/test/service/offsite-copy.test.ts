import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import config from 'config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The logger module is mocked wholesale because `createLogger` returns a new
 * pino child per call, and pino is silent under test; recording the calls is
 * the only way to read what a failure would have written.
 */
const { logCalls } = vi.hoisted(() => ({ logCalls: [] as unknown[][] }));

vi.mock('@/server/common/helper/logger', () => {
  const record = (level: string) => (...args: unknown[]) => { logCalls.push([level, ...args]); };
  const stub: Record<string, unknown> = {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
    level: 'silent',
  };
  stub.child = () => stub;
  return { createLogger: () => stub, default: stub };
});

import OffsiteCopyService from '@/server/housekeeping/service/offsite-copy';
import S3Destination from '@/server/housekeeping/service/offsite/s3';
import type { OffsiteDestination } from '@/server/housekeeping/service/offsite/destination';

const ACCESS_KEY = 'AKIAEXAMPLEACCESSKEY';
const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLESECRET';
const DUMP = '/backups/pavillion_20261114-020000_daily.dump';

interface FakeDestination extends OffsiteDestination {
  put: sinon.SinonStub;
}

/**
 * Unit coverage for the driver-agnostic off-host copy: driver selection, the
 * never-rejects contract, and the credential-free startup and failure logs.
 * A fake destination stands in for a real one; S3Destination has its own
 * suite.
 */
describe('OffsiteCopyService', () => {
  let sandbox: sinon.SinonSandbox;
  let configStub: sinon.SinonStub;

  function fakeDestination(overrides: Partial<OffsiteDestination> = {}): FakeDestination {
    return {
      configError: null,
      logFields: { bucket: 'community-backups', endpointHost: 's3.example.com', credentialSource: 'static keys' },
      secrets: [ACCESS_KEY, SECRET_KEY],
      put: sandbox.stub().resolves(),
      ...overrides,
    } as FakeDestination;
  }

  function useDriver(driver: string | undefined) {
    configStub.withArgs('housekeeping.backup.offsite.driver').returns(driver);
  }

  function errorLogs(): unknown[][] {
    return logCalls.filter((call) => call[0] === 'error');
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    logCalls.length = 0;
    const realGet = config.get.bind(config);
    configStub = sandbox.stub(config, 'get').callsFake((key: any) => realGet(key));
    // Every key the service reads is stubbed: node-config freezes itself on
    // its first real get(), after which the sandbox cannot restore the stub.
    useDriver('s3');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('fromConfig', () => {
    it('should select the s3 destination for the s3 driver', () => {
      const destination = fakeDestination();
      const build = sandbox.stub(S3Destination, 'fromConfig').returns(destination as unknown as S3Destination);

      const service = OffsiteCopyService.fromConfig();

      expect(build.calledOnce).toBe(true);
      expect(service).not.toBeNull();
      expect(service!.configError).toBeNull();
    });

    it('should return null when the selected destination has no target configured', () => {
      sandbox.stub(S3Destination, 'fromConfig').returns(null);

      expect(OffsiteCopyService.fromConfig()).toBeNull();
      expect(logCalls).toHaveLength(0);
    });

    it("should carry the destination's configError", () => {
      sandbox.stub(S3Destination, 'fromConfig')
        .returns(fakeDestination({ configError: 'Set both keys' }) as unknown as S3Destination);

      expect(OffsiteCopyService.fromConfig()!.configError).toBe('Set both keys');
    });

    it.each([
      ['an unknown driver', 'ftp'],
      ['an empty driver', ''],
      ['an inherited method name', 'toString'],
      ['the prototype key', '__proto__'],
      ['the constructor key', 'constructor'],
    ])('should set a configError naming the supported drivers for %s', (_label, driver) => {
      useDriver(driver);
      const build = sandbox.stub(S3Destination, 'fromConfig');

      const service = OffsiteCopyService.fromConfig();

      expect(build.called).toBe(false);
      expect(service).not.toBeNull();
      expect(service!.configError).toMatch(/not supported \(supported: s3\)/);
    });

    it('should not echo a driver value that is not shaped like a driver name', () => {
      useDriver(`AKIA ${SECRET_KEY}`);

      const service = OffsiteCopyService.fromConfig()!;
      service.logStartup();

      expect(service.configError).toContain('"(invalid value)"');
      expect(logCalls[0][1]).toMatchObject({ driver: '(invalid value)' });
      expect(JSON.stringify(logCalls)).not.toContain(SECRET_KEY);
    });
  });

  describe('logStartup', () => {
    it('should name the driver and the destination fields at info level', () => {
      new OffsiteCopyService('s3', fakeDestination()).logStartup();

      expect(logCalls).toHaveLength(1);
      expect(logCalls[0][0]).toBe('info');
      expect(logCalls[0][1]).toEqual({
        driver: 's3',
        bucket: 'community-backups',
        endpointHost: 's3.example.com',
        credentialSource: 'static keys',
      });
      expect(logCalls[0][2]).toBe('Off-host backup copy enabled');
    });

    it('should log the configError at error level without a secret', () => {
      new OffsiteCopyService('s3', fakeDestination({ configError: 'Set both keys' })).logStartup();

      expect(logCalls).toHaveLength(1);
      expect(logCalls[0][0]).toBe('error');
      expect(logCalls[0][1]).toMatchObject({ driver: 's3', configError: 'Set both keys' });
      expect(JSON.stringify(logCalls)).not.toContain(SECRET_KEY);
    });

    it('should log an unknown driver at error level', () => {
      useDriver('ftp');

      OffsiteCopyService.fromConfig()!.logStartup();

      expect(logCalls[0][0]).toBe('error');
      expect(logCalls[0][1]).toEqual({
        driver: 'ftp',
        configError: expect.stringMatching(/"ftp" is not supported/),
      });
    });
  });

  describe('copy', () => {
    it('should put the dump under pavillion-backups/ and resolve true', async () => {
      const destination = fakeDestination();

      const result = await new OffsiteCopyService('s3', destination).copy(DUMP);

      expect(result).toBe(true);
      expect(destination.put.calledOnce).toBe(true);
      const [localPath, name, signal] = destination.put.firstCall.args;
      expect(localPath).toBe(DUMP);
      expect(name).toBe('pavillion-backups/pavillion_20261114-020000_daily.dump');
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(errorLogs()).toHaveLength(0);
    });

    it('should log the configError and resolve false without calling put', async () => {
      const destination = fakeDestination({ configError: 'Set both keys' });

      const result = await new OffsiteCopyService('s3', destination).copy(DUMP);

      expect(result).toBe(false);
      expect(destination.put.called).toBe(false);
      expect(errorLogs()).toHaveLength(1);
      expect(errorLogs()[0][1]).toMatchObject({ errorName: 'OffsiteConfigError', errorMessage: 'Set both keys' });
      expect(errorLogs()[0][2]).toBe('Off-host backup copy failed');
    });

    it('should resolve false for an unknown driver and name it in the log', async () => {
      useDriver('ftp');

      const result = await OffsiteCopyService.fromConfig()!.copy(DUMP);

      expect(result).toBe(false);
      expect(errorLogs()[0][1]).toMatchObject({ driver: 'ftp', errorName: 'OffsiteConfigError' });
    });

    it('should resolve false when put rejects', async () => {
      const destination = fakeDestination({ put: sandbox.stub().rejects(new Error('boom')) });

      await expect(new OffsiteCopyService('s3', destination).copy(DUMP)).resolves.toBe(false);
      expect(errorLogs()[0][1]).toMatchObject({ errorMessage: 'boom' });
    });

    it('should resolve false when put throws synchronously', async () => {
      const destination = fakeDestination({ put: sandbox.stub().throws(new TypeError('synchronous failure')) });

      await expect(new OffsiteCopyService('s3', destination).copy(DUMP)).resolves.toBe(false);
    });

    it('should resolve false when put rejects with a non-Error value', async () => {
      const destination = fakeDestination({ put: sandbox.stub().rejects('plain string') });

      await expect(new OffsiteCopyService('s3', destination).copy(DUMP)).resolves.toBe(false);
      expect(errorLogs()).toHaveLength(1);
    });

    it('should log only the whitelisted fields, with the destination secrets redacted', async () => {
      const error = Object.assign(new Error(`Signature for ${ACCESS_KEY} with ${SECRET_KEY} does not match`), {
        name: 'SignatureDoesNotMatch',
        Code: `Bad-${SECRET_KEY}`,
        $metadata: { httpStatusCode: 403, requestId: ACCESS_KEY },
        $response: { headers: { authorization: SECRET_KEY } },
        credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
      });
      const destination = fakeDestination({ put: sandbox.stub().rejects(error) });

      const result = await new OffsiteCopyService('s3', destination).copy(DUMP);

      expect(result).toBe(false);
      const [[level, fields, message]] = errorLogs();
      expect(level).toBe('error');
      expect(message).toBe('Off-host backup copy failed');
      expect(Object.keys(fields as object).sort()).toEqual(
        [
          'bucket', 'credentialSource', 'driver', 'endpointHost',
          'errorCode', 'errorMessage', 'errorName', 'filename', 'httpStatus',
        ],
      );
      expect(fields).toMatchObject({
        filename: 'pavillion_20261114-020000_daily.dump',
        driver: 's3',
        bucket: 'community-backups',
        endpointHost: 's3.example.com',
        errorName: 'SignatureDoesNotMatch',
        errorCode: 'Bad-[redacted]',
        httpStatus: 403,
        errorMessage: 'Signature for [redacted] with [redacted] does not match',
      });
      const serialised = JSON.stringify(logCalls);
      expect(serialised).not.toContain(ACCESS_KEY);
      expect(serialised).not.toContain(SECRET_KEY);
    });

    it("should not let a destination's fields overwrite the service's own", async () => {
      const destination = fakeDestination({
        logFields: { driver: 'spoofed', filename: 'spoofed', bucket: 'community-backups' },
        put: sandbox.stub().rejects(new Error('boom')),
      });

      await new OffsiteCopyService('s3', destination).copy(DUMP);

      expect(errorLogs()[0][1]).toMatchObject({
        driver: 's3',
        filename: 'pavillion_20261114-020000_daily.dump',
        errorMessage: 'boom',
      });
    });

    it('should read the error code from a Node system error', async () => {
      const destination = fakeDestination({
        put: sandbox.stub().rejects(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
      });

      await new OffsiteCopyService('s3', destination).copy(DUMP);

      expect(errorLogs()[0][1]).toMatchObject({ errorCode: 'ECONNREFUSED', httpStatus: undefined });
    });

    it('should pass an error message through unaltered when the destination has no secrets', async () => {
      const destination = fakeDestination({ secrets: [], put: sandbox.stub().rejects(new Error('Access Denied')) });

      await new OffsiteCopyService('s3', destination).copy(DUMP);

      expect(errorLogs()[0][1]).toMatchObject({ errorMessage: 'Access Denied' });
    });
  });

  describe('module boundaries', () => {
    const serviceDir = path.resolve(__dirname, '../../service');
    const read = (file: string) => fs.readFileSync(path.join(serviceDir, file), 'utf8');

    it('should keep the copy service free of any storage SDK', () => {
      // Destination-specific code lives behind OffsiteDestination.
      expect(read('offsite-copy.ts')).not.toMatch(/@aws-sdk|flydrive|@google-cloud/);
    });

    it('should give a destination no way to delete, list or overwrite-check', () => {
      const methods = [...read('offsite/destination.ts').matchAll(/^\s+(\w+)\s*\(/gm)].map((match) => match[1]);

      expect(methods).toEqual(['put']);
    });

    it("should not import Media's storage factory", () => {
      expect(read('offsite-copy.ts')).not.toMatch(/storage-factory/);
      expect(read('offsite/destination.ts')).not.toMatch(/storage-factory/);
    });
  });
});
