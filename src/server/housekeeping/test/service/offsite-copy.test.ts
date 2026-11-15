import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import config from 'config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

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

import OffsiteCopyService, { buildClientConfig } from '@/server/housekeeping/service/offsite-copy';

const ACCESS_KEY = 'AKIAEXAMPLEACCESSKEY';
const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLESECRET';

interface S3Settings {
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * Unit coverage for the off-host copy: configuration validation, client
 * construction, the upload itself, and the never-rejects contract with its
 * credential-free failure log.
 */
describe('OffsiteCopyService', () => {
  let sandbox: sinon.SinonSandbox;
  let configStub: sinon.SinonStub;
  let tmpDir: string;

  function useSettings(settings: S3Settings) {
    configStub.withArgs('housekeeping.backup.offsite.s3').returns({
      bucket: 'community-backups',
      region: 'eu-west-1',
      endpoint: '',
      ...settings,
    });
  }

  /** A fake client whose send reads the whole body, as the real one would. */
  function consumingClient(): { client: S3Client; send: sinon.SinonStub } {
    const send = sandbox.stub().callsFake(async (command: PutObjectCommand) => {
      for await (const chunk of command.input.Body as AsyncIterable<Buffer>) {
        void chunk;
      }
      return {};
    });
    return { client: { send } as unknown as S3Client, send };
  }

  function writeDump(name = 'pavillion_20261114-020000_daily.dump', contents = 'x'.repeat(4096)): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, contents);
    return filePath;
  }

  function errorLogs(): unknown[][] {
    return logCalls.filter((call) => call[0] === 'error');
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    logCalls.length = 0;
    const realGet = config.get.bind(config);
    configStub = sandbox.stub(config, 'get').callsFake((key: any) => realGet(key));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsite-copy-'));
  });

  afterEach(() => {
    sandbox.restore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('fromConfig', () => {
    it.each([
      ['unset', undefined],
      ['empty', ''],
      ['whitespace-only', '   '],
    ])('should return null when the bucket is %s', (_label, bucket) => {
      useSettings({ bucket: bucket as string | undefined });
      // No client is injected: a null result is reached before the default
      // client would be built, and nothing is logged.
      expect(OffsiteCopyService.fromConfig()).toBeNull();
      expect(logCalls).toHaveLength(0);
    });

    it('should return an instance with no configError for a valid config', () => {
      useSettings({ accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY });

      const service = OffsiteCopyService.fromConfig(consumingClient().client);

      expect(service).not.toBeNull();
      expect(service!.configError).toBeNull();
    });

    it('should treat absent credential keys as empty and use the default chain', () => {
      useSettings({});

      const service = OffsiteCopyService.fromConfig(consumingClient().client);

      expect(service!.configError).toBeNull();
    });

    it.each([
      ['only the access key', { accessKeyId: ACCESS_KEY, secretAccessKey: '' }],
      ['only the secret key', { accessKeyId: '', secretAccessKey: SECRET_KEY }],
    ])('should set a configError when %s is set', (_label, keys) => {
      useSettings(keys);

      const service = OffsiteCopyService.fromConfig(consumingClient().client);

      expect(service!.configError).toMatch(/both/i);
    });

    it.each([
      ['https://s3.example.com'],
      ['http://localhost:9000'],
      ['http://127.0.0.1:9000'],
    ])('should accept the endpoint %s', (endpoint) => {
      useSettings({ endpoint });

      expect(OffsiteCopyService.fromConfig(consumingClient().client)!.configError).toBeNull();
    });

    it.each([
      ['http://minio:9000'],
      ['http://localhost.example.com'],
      ['https://user:pass@s3.example.com'],
      ['ftp://s3.example.com'],
      ['not a url'],
    ])('should set a configError for the endpoint %s', (endpoint) => {
      useSettings({ endpoint });

      const service = OffsiteCopyService.fromConfig(consumingClient().client);

      expect(service!.configError).toBeTruthy();
      expect(service!.configError).not.toContain('pass');
    });
  });

  describe('buildClientConfig', () => {
    const base = { bucket: 'b', region: 'eu-west-1', endpoint: '', accessKeyId: '', secretAccessKey: '' };

    it('should carry static credentials when both keys are set', () => {
      const result = buildClientConfig({ ...base, accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY });

      expect(result.credentials).toEqual({ accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY });
    });

    it('should carry no credentials key when neither key is set', () => {
      const result = buildClientConfig(base);

      expect(Object.prototype.hasOwnProperty.call(result, 'credentials')).toBe(false);
    });

    it('should use path-style addressing exactly when an endpoint is set', () => {
      expect(buildClientConfig(base).forcePathStyle).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(buildClientConfig(base), 'endpoint')).toBe(false);

      const custom = buildClientConfig({ ...base, endpoint: 'https://s3.example.com' });
      expect(custom.forcePathStyle).toBe(true);
      expect(custom.endpoint).toBe('https://s3.example.com');
    });

    it('should set the region, three attempts and connection and socket timeouts', () => {
      const result = buildClientConfig(base);

      expect(result.region).toBe('eu-west-1');
      expect(result.maxAttempts).toBe(3);
      expect(result.requestHandler).toEqual({
        connectionTimeout: expect.any(Number),
        socketTimeout: expect.any(Number),
      });
    });
  });

  describe('logStartup', () => {
    it('should name the bucket, AWS and the default credential chain', () => {
      useSettings({});

      OffsiteCopyService.fromConfig(consumingClient().client)!.logStartup();

      expect(logCalls).toHaveLength(1);
      expect(logCalls[0][0]).toBe('info');
      expect(logCalls[0][1]).toEqual({
        bucket: 'community-backups',
        endpointHost: 'AWS',
        credentialSource: 'default credential chain',
      });
    });

    it('should name the endpoint host and static keys without the key values', () => {
      useSettings({ endpoint: 'https://s3.example.com', accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY });

      OffsiteCopyService.fromConfig(consumingClient().client)!.logStartup();

      expect(logCalls[0][1]).toEqual({
        bucket: 'community-backups',
        endpointHost: 's3.example.com',
        credentialSource: 'static keys',
      });
      const serialised = JSON.stringify(logCalls);
      expect(serialised).not.toContain(SECRET_KEY);
      expect(serialised).not.toContain(ACCESS_KEY);
    });

    it('should log the configError at error level without the secret', () => {
      useSettings({ accessKeyId: '', secretAccessKey: SECRET_KEY });

      OffsiteCopyService.fromConfig(consumingClient().client)!.logStartup();

      expect(logCalls).toHaveLength(1);
      expect(logCalls[0][0]).toBe('error');
      expect(JSON.stringify(logCalls)).not.toContain(SECRET_KEY);
    });
  });

  describe('copy', () => {
    it('should send one PutObjectCommand with the bucket, key and on-disk size and resolve true', async () => {
      useSettings({});
      const { client, send } = consumingClient();
      const dump = writeDump();

      const result = await OffsiteCopyService.fromConfig(client)!.copy(dump);

      expect(result).toBe(true);
      expect(send.calledOnce).toBe(true);
      const command = send.firstCall.args[0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input.Bucket).toBe('community-backups');
      expect(command.input.Key).toBe('pavillion-backups/pavillion_20261114-020000_daily.dump');
      expect(command.input.ContentLength).toBe(fs.statSync(dump).size);
      expect(send.firstCall.args[1]).toHaveProperty('abortSignal');
      expect(errorLogs()).toHaveLength(0);
    });

    it('should destroy the source and body streams after a successful copy', async () => {
      useSettings({});
      let body: NodeJS.ReadableStream & { destroyed: boolean } | undefined;
      const send = sandbox.stub().callsFake(async (command: PutObjectCommand) => {
        body = command.input.Body as any;
        return {};
      });
      const dump = writeDump();

      await OffsiteCopyService.fromConfig({ send } as unknown as S3Client)!.copy(dump);

      expect(body!.destroyed).toBe(true);
    });

    it('should log the configError and resolve false without calling send', async () => {
      useSettings({ accessKeyId: ACCESS_KEY, secretAccessKey: '' });
      const { client, send } = consumingClient();

      const result = await OffsiteCopyService.fromConfig(client)!.copy(writeDump());

      expect(result).toBe(false);
      expect(send.called).toBe(false);
      expect(errorLogs()).toHaveLength(1);
      expect(errorLogs()[0][2]).toBe('Off-host backup copy failed');
      expect(JSON.stringify(logCalls)).not.toContain(ACCESS_KEY);
    });

    it('should resolve false when send rejects', async () => {
      useSettings({});
      const send = sandbox.stub().rejects(new Error('boom'));

      await expect(OffsiteCopyService.fromConfig({ send } as unknown as S3Client)!.copy(writeDump()))
        .resolves.toBe(false);
    });

    it('should resolve false when the file is missing, without calling send', async () => {
      useSettings({});
      const { client, send } = consumingClient();

      const result = await OffsiteCopyService.fromConfig(client)!.copy(path.join(tmpDir, 'missing.dump'));

      expect(result).toBe(false);
      expect(send.called).toBe(false);
      expect(errorLogs()[0][1]).toMatchObject({ filename: 'missing.dump', errorCode: 'ENOENT' });
    });

    it('should resolve false when the client throws synchronously', async () => {
      useSettings({});
      const send = sandbox.stub().throws(new TypeError('synchronous failure'));

      await expect(OffsiteCopyService.fromConfig({ send } as unknown as S3Client)!.copy(writeDump()))
        .resolves.toBe(false);
    });

    it('should resolve false and raise no uncaughtException when the read fails after the stat', async () => {
      useSettings({});
      const { client } = consumingClient();
      const uncaught = sinon.spy();
      process.on('uncaughtException', uncaught);

      try {
        // A directory stats successfully and then fails to read with EISDIR.
        const result = await OffsiteCopyService.fromConfig(client)!.copy(tmpDir);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(result).toBe(false);
        expect(uncaught.called).toBe(false);
        expect(errorLogs()[0][1]).toMatchObject({ errorCode: 'EISDIR' });
      }
      finally {
        process.off('uncaughtException', uncaught);
      }
    });

    it('should log only the whitelisted fields, with the configured keys redacted', async () => {
      useSettings({ endpoint: 'https://s3.example.com', accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY });
      const error = Object.assign(new Error(`Signature for ${ACCESS_KEY} with ${SECRET_KEY} does not match`), {
        name: 'SignatureDoesNotMatch',
        Code: `Bad-${SECRET_KEY}`,
        $metadata: { httpStatusCode: 403, requestId: ACCESS_KEY },
        $response: { headers: { authorization: SECRET_KEY } },
        credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
      });
      const send = sandbox.stub().rejects(error);

      const result = await OffsiteCopyService.fromConfig({ send } as unknown as S3Client)!.copy(writeDump());

      expect(result).toBe(false);
      const [[level, fields, message]] = errorLogs();
      expect(level).toBe('error');
      expect(message).toBe('Off-host backup copy failed');
      expect(Object.keys(fields as object).sort()).toEqual(
        ['bucket', 'endpointHost', 'errorCode', 'errorMessage', 'errorName', 'filename', 'httpStatus'],
      );
      expect(fields).toMatchObject({
        filename: 'pavillion_20261114-020000_daily.dump',
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
      expect(serialised).toContain('s3.example.com');
    });

    it('should read the error code from a Node socket error', async () => {
      useSettings({});
      const send = sandbox.stub().rejects(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

      await OffsiteCopyService.fromConfig({ send } as unknown as S3Client)!.copy(writeDump());

      expect(errorLogs()[0][1]).toMatchObject({ errorCode: 'ECONNREFUSED', httpStatus: undefined });
    });

    it('should pass an error message through unaltered when no keys are configured', async () => {
      useSettings({ accessKeyId: '', secretAccessKey: '' });
      const send = sandbox.stub().rejects(new Error('Access Denied'));

      await OffsiteCopyService.fromConfig({ send } as unknown as S3Client)!.copy(writeDump());

      expect(errorLogs()[0][1]).toMatchObject({ errorMessage: 'Access Denied' });
    });
  });

  describe('module boundaries', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../service/offsite-copy.ts'),
      'utf8',
    );

    it('should import no delete command', () => {
      expect(source).not.toMatch(/Delete\w*Command/);
    });

    it("should not import Media's storage factory", () => {
      expect(source).not.toMatch(/storage-factory/);
    });
  });
});
