/**
 * Shared fixtures for testing that federation fetches connect to the address
 * that passed SSRF validation. Used with a file-level `vi.mock('dns')`.
 */
import type https from 'https';
import type { Mock } from 'vitest';

export const PUBLIC_IP = '93.184.216.34';
export const PRIVATE_IP = '10.0.0.5';

/**
 * Point a mocked `dns.lookup` at a sequence of IPv4 answers: the nth IPv4
 * resolution returns `answers[n]`, and every resolution past the end repeats
 * the last answer. An empty sequence makes every resolution fail. IPv6
 * resolutions always fail.
 *
 * @returns a counter of IPv4 resolutions made so far
 */
export function mockDnsLookup(lookup: Mock, answers: string[]): { resolutions: () => number } {
  let resolutions = 0;
  lookup.mockImplementation((_hostname: string, options: { family?: number }, callback: (...args: unknown[]) => void) => {
    if (options?.family === 4 && answers.length > 0) {
      const address = answers[Math.min(resolutions, answers.length - 1)];
      resolutions += 1;
      callback(null, [{ address, family: 4 }]);
      return;
    }
    callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
  });
  return { resolutions: () => resolutions };
}

/**
 * Ask an `https.Agent`'s `lookup` where it would connect for an arbitrary
 * hostname — the address the socket would actually be opened to.
 */
export function pinnedAddressOf(agent: https.Agent): Promise<string> {
  const lookup = (agent as unknown as {
    options: { lookup: (host: string, opts: object, cb: (err: Error | null, address: string) => void) => void };
  }).options.lookup;
  return new Promise((resolve, reject) => {
    lookup('any-host.example', {}, (err, address) => (err ? reject(err) : resolve(address)));
  });
}
