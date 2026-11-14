import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import { Router } from 'express';
import request from 'supertest';
import { testApp } from '@/server/common/test/lib/express';

const SRC_DIR = path.resolve(__dirname, '../../..');

// A port-0 listen with no host, or with a host other than 127.0.0.1.
const BAD_LISTEN = /\.listen\(\s*0\s*(?:\)|,(?!\s*['"]127\.0\.0\.1['"]))/;

function testFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : testFiles(fullPath);
    }
    const inTestDir = fullPath.split(path.sep).includes('test');
    return entry.name.endsWith('.ts') && (entry.name.endsWith('.test.ts') || inTestDir) ? [fullPath] : [];
  });
}

describe('Test listeners bind to loopback', () => {
  it('has no port-0 listen without a 127.0.0.1 host', () => {
    const offenders: string[] = [];
    for (const file of testFiles(SRC_DIR)) {
      if (file === __filename) {
        continue;
      }
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (BAD_LISTEN.test(line)) {
          offenders.push(`${path.relative(SRC_DIR, file)}:${index + 1}`);
        }
      });
    }

    expect(
      offenders,
      'port-0 listen() must name 127.0.0.1: a wildcard bind can be shadowed by a loopback listener from a sibling worker on macOS, so a request is answered by a different app',
    ).toEqual([]);
  });

  it('binds the server supertest starts to 127.0.0.1', async () => {
    const router = Router();
    router.get('/x', (_req, res) => {
      res.json({ ok: true });
    });
    const server = http.createServer(testApp(router));
    let boundAddress: string | undefined;
    server.on('listening', () => {
      boundAddress = (server.address() as AddressInfo).address;
    });

    await request(server).get('/x').expect(200);

    expect(boundAddress).toBe('127.0.0.1');
  });
});
