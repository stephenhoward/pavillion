import { describe, it, expect, beforeEach, afterEach, onTestFinished, vi } from 'vitest';
import sinon from 'sinon';
import config from 'config';
import { execFileSync } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import S3Destination, { buildClientConfig } from '@/server/housekeeping/service/offsite/s3';

const ACCESS_KEY = 'AKIAEXAMPLEACCESSKEY';
const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLESECRET';
const NAME = 'pavillion-backups/pavillion_20261114-020000_daily.dump';

interface S3Settings {
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * Unit coverage for the S3 destination: settings validation, client
 * construction, the fields it contributes to log lines, and the upload with
 * its stream-error containment. The never-rejects contract and the failure
 * log belong to OffsiteCopyService and are covered there.
 */
describe('S3Destination', () => {
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

  /**
   * A fake client whose send reads the whole body, as the real one would.
   * `drained` holds the bytes of each body it read, in call order.
   */
  function consumingClient(): { client: S3Client; send: sinon.SinonStub; drained: Buffer[] } {
    const drained: Buffer[] = [];
    const send = sandbox.stub().callsFake(async (command: PutObjectCommand) => {
      const chunks: Buffer[] = [];
      for await (const chunk of command.input.Body as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
      drained.push(Buffer.concat(chunks));
      return {};
    });
    return { client: { send } as unknown as S3Client, send, drained };
  }

  function writeDump(name = 'pavillion_20261114-020000_daily.dump', contents: string | Buffer = 'x'.repeat(4096)): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, contents);
    return filePath;
  }

  function signal(): AbortSignal {
    return new AbortController().signal;
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const realGet = config.get.bind(config);
    configStub = sandbox.stub(config, 'get').callsFake((key: any) => realGet(key));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsite-s3-'));
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
      // client would be built.
      expect(S3Destination.fromConfig()).toBeNull();
    });

    it('should return a destination with no configError for a valid config', () => {
      useSettings({ accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY });

      const destination = S3Destination.fromConfig(consumingClient().client);

      expect(destination).not.toBeNull();
      expect(destination!.configError).toBeNull();
    });

    it('should treat absent credential keys as empty and use the default chain', () => {
      useSettings({});

      const destination = S3Destination.fromConfig(consumingClient().client);

      expect(destination!.configError).toBeNull();
      expect(destination!.logFields).toMatchObject({ credentialSource: 'default credential chain' });
    });

    it.each([
      ['only the access key', { accessKeyId: ACCESS_KEY, secretAccessKey: '' }],
      ['only the secret key', { accessKeyId: '', secretAccessKey: SECRET_KEY }],
    ])('should set a configError when %s is set', (_label, keys) => {
      useSettings(keys);

      const destination = S3Destination.fromConfig(consumingClient().client);

      expect(destination!.configError).toMatch(/both/i);
      expect(destination!.configError).not.toContain(ACCESS_KEY);
      expect(destination!.configError).not.toContain(SECRET_KEY);
    });

    it.each([
      ['https://s3.example.com'],
      ['http://localhost:9000'],
      ['http://127.0.0.1:9000'],
    ])('should accept the endpoint %s', (endpoint) => {
      useSettings({ endpoint });

      expect(S3Destination.fromConfig(consumingClient().client)!.configError).toBeNull();
    });

    it.each([
      ['http://minio:9000'],
      ['http://localhost.example.com'],
      ['https://user:pass@s3.example.com'],
      ['ftp://s3.example.com'],
      ['not a url'],
    ])('should set a configError for the endpoint %s', (endpoint) => {
      useSettings({ endpoint });

      const destination = S3Destination.fromConfig(consumingClient().client);

      expect(destination!.configError).toBeTruthy();
      expect(destination!.configError).not.toContain('pass');
    });
  });

  describe('log fields and secrets', () => {
    it('should name the bucket, AWS and the default credential chain when no endpoint or keys are set', () => {
      useSettings({});

      expect(S3Destination.fromConfig(consumingClient().client)!.logFields).toEqual({
        bucket: 'community-backups',
        endpointHost: 'AWS',
        credentialSource: 'default credential chain',
      });
    });

    it('should name the endpoint host and static keys without the key values', () => {
      useSettings({ endpoint: 'https://s3.example.com', accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY });

      const destination = S3Destination.fromConfig(consumingClient().client)!;

      expect(destination.logFields).toEqual({
        bucket: 'community-backups',
        endpointHost: 's3.example.com',
        credentialSource: 'static keys',
      });
      const serialised = JSON.stringify(destination.logFields);
      expect(serialised).not.toContain(ACCESS_KEY);
      expect(serialised).not.toContain(SECRET_KEY);
    });

    it('should list both configured keys as secrets', () => {
      useSettings({ accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY });

      expect(S3Destination.fromConfig(consumingClient().client)!.secrets).toEqual([ACCESS_KEY, SECRET_KEY]);
    });

    it('should list no secrets when no keys are configured, so nothing empty is redacted', () => {
      useSettings({ accessKeyId: '', secretAccessKey: '' });

      expect(S3Destination.fromConfig(consumingClient().client)!.secrets).toEqual([]);
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

    it('should pin request checksums to WHEN_REQUIRED so no body is sent aws-chunked', () => {
      // The SDK default (WHEN_SUPPORTED) frames the body aws-chunked with a
      // trailing CRC32, which a store that does not decode it saves verbatim.
      expect(buildClientConfig(base).requestChecksumCalculation).toBe('WHEN_REQUIRED');
      expect(buildClientConfig({ ...base, endpoint: 'https://s3.example.com', accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY })
        .requestChecksumCalculation).toBe('WHEN_REQUIRED');
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

  describe('put', () => {
    it('should send one PutObjectCommand with the bucket, name and on-disk size', async () => {
      useSettings({});
      const { client, send } = consumingClient();
      const dump = writeDump();

      await S3Destination.fromConfig(client)!.put(dump, NAME, signal());

      expect(send.calledOnce).toBe(true);
      const command = send.firstCall.args[0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input.Bucket).toBe('community-backups');
      expect(command.input.Key).toBe(NAME);
      expect(command.input.ContentLength).toBe(fs.statSync(dump).size);
      expect(send.firstCall.args[1].abortSignal).toBeInstanceOf(AbortSignal);
    });

    it('should send the base64 MD5 of the file as ContentMD5', async () => {
      useSettings({});
      const { client, send } = consumingClient();
      const contents = randomBytes(300_000);
      const dump = writeDump(undefined, contents);

      await S3Destination.fromConfig(client)!.put(dump, NAME, signal());

      const expected = createHash('md5').update(contents).digest('base64');
      expect(send.firstCall.args[0].input.ContentMD5).toBe(expected);
    });

    it('should stream a body equal to the file contents byte for byte', async () => {
      useSettings({});
      const { client, drained } = consumingClient();
      // Larger than one read-stream chunk, so the body arrives in pieces.
      const contents = randomBytes(300_000);
      const dump = writeDump(undefined, contents);

      await S3Destination.fromConfig(client)!.put(dump, NAME, signal());

      expect(drained).toHaveLength(1);
      expect(drained[0].equals(contents)).toBe(true);
    });

    it('should reject without calling send when the caller has aborted before the digest is computed', async () => {
      useSettings({});
      const { client, send } = consumingClient();
      const caller = new AbortController();
      caller.abort();

      await expect(S3Destination.fromConfig(client)!.put(writeDump(undefined, randomBytes(300_000)), NAME, caller.signal))
        .rejects.toMatchObject({ name: 'AbortError' });
      expect(send.called).toBe(false);
    });

    it('should stop the digest and reject without calling send when the caller aborts mid-read', async () => {
      useSettings({});
      const { client, send } = consumingClient();
      const caller = new AbortController();
      // A FIFO keeps the digest pass reading for as long as its writer stays
      // open, so the abort lands while the pass is in flight; without the
      // abort the pass would never finish.
      const fifo = path.join(tmpDir, 'pavillion_20261114-020000_daily.dump');
      execFileSync('mkfifo', [fifo]);
      const writer = fs.createWriteStream(fifo);
      writer.on('error', () => {});
      // Closed when the test ends however it ends, timeout included.
      onTestFinished(() => {
        writer.destroy();
      });

      const pending = S3Destination.fromConfig(client)!.put(fifo, NAME, caller.signal);
      await new Promise<void>((resolve, reject) => {
        writer.write(randomBytes(64 * 1024), (error) => (error ? reject(error) : resolve()));
      });
      caller.abort();

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(send.called).toBe(false);
    });

    it('should abort the request when the caller aborts', async () => {
      useSettings({});
      let requestSignal: AbortSignal | undefined;
      const send = sandbox.stub().callsFake((_command: PutObjectCommand, options: { abortSignal: AbortSignal }) => {
        requestSignal = options.abortSignal;
        return new Promise((_, reject) => {
          options.abortSignal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      });
      const caller = new AbortController();

      const pending = S3Destination.fromConfig({ send } as unknown as S3Client)!.put(writeDump(), NAME, caller.signal);
      await vi.waitFor(() => expect(send.called).toBe(true));
      caller.abort();

      await expect(pending).rejects.toThrow('aborted');
      expect(requestSignal!.aborted).toBe(true);
    });

    it('should destroy the source and body streams after a successful upload', async () => {
      useSettings({});
      let body: NodeJS.ReadableStream & { destroyed: boolean } | undefined;
      const send = sandbox.stub().callsFake(async (command: PutObjectCommand) => {
        body = command.input.Body as any;
        return {};
      });

      await S3Destination.fromConfig({ send } as unknown as S3Client)!.put(writeDump(), NAME, signal());

      expect(body!.destroyed).toBe(true);
    });

    it('should reject without a client when the config is invalid', async () => {
      useSettings({ accessKeyId: ACCESS_KEY, secretAccessKey: '' });

      await expect(S3Destination.fromConfig(consumingClient().client)!.put(writeDump(), NAME, signal()))
        .rejects.toMatchObject({ name: 'OffsiteConfigError' });
    });

    it('should reject when send rejects', async () => {
      useSettings({});
      const send = sandbox.stub().rejects(new Error('boom'));

      await expect(S3Destination.fromConfig({ send } as unknown as S3Client)!.put(writeDump(), NAME, signal()))
        .rejects.toThrow('boom');
    });

    it('should reject with ENOENT when the file is missing, without calling send', async () => {
      useSettings({});
      const { client, send } = consumingClient();

      await expect(S3Destination.fromConfig(client)!.put(path.join(tmpDir, 'missing.dump'), NAME, signal()))
        .rejects.toMatchObject({ code: 'ENOENT' });
      expect(send.called).toBe(false);
    });

    it('should reject when the client throws synchronously', async () => {
      useSettings({});
      const send = sandbox.stub().throws(new TypeError('synchronous failure'));

      await expect(S3Destination.fromConfig({ send } as unknown as S3Client)!.put(writeDump(), NAME, signal()))
        .rejects.toThrow('synchronous failure');
    });

    it('should reject without calling send and raise no uncaughtException when the read fails after the stat', async () => {
      useSettings({});
      const { client, send } = consumingClient();
      const uncaught = sinon.spy();
      process.on('uncaughtException', uncaught);

      try {
        // A directory stats successfully and then fails to read with EISDIR.
        await expect(S3Destination.fromConfig(client)!.put(tmpDir, NAME, signal()))
          .rejects.toMatchObject({ code: 'EISDIR' });
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(uncaught.called).toBe(false);
        // The digest pass reads the file first, so the read error ends the
        // attempt before any request is made.
        expect(send.called).toBe(false);
      }
      finally {
        process.off('uncaughtException', uncaught);
      }
    });
  });

  describe('module boundaries', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../service/offsite/s3.ts'),
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
