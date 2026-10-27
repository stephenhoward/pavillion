/**
 * Pinned-IP connection agents — the socket-layer DNS-rebinding defence shared
 * by every outbound fetch to a user- or peer-supplied URL.
 *
 * Callers validate a hostname's resolved addresses first, then build an agent
 * whose `lookup` always answers with *that* exact IP. A second DNS resolution
 * at connect time therefore cannot redirect the connection to a different
 * (possibly private) address.
 *
 * The defence lives in exactly one place, {@link createPinnedLookup}. The two
 * exported agent factories are thin transport adapters over it:
 *
 * - {@link createPinnedAgent} — an undici `Agent`, used by the ICS fetcher and
 *   the rel=me page fetch, which issue requests through `undici.request`.
 * - {@link createPinnedHttpsAgent} — a Node `https.Agent`, used as axios's
 *   `httpsAgent` by the ActivityPub remote-object and public-key fetches.
 */
import https from 'https';
import { Agent } from 'undici';

/**
 * The `dns.lookup`-compatible function both transports accept as `lookup`.
 */
export type PinnedLookup = (
  hostname: string,
  options: unknown,
  callback: (
    err: NodeJS.ErrnoException | null,
    addressOrAddresses: string | Array<{ address: string; family: number }>,
    family?: number,
  ) => void,
) => void;

/**
 * Build a `lookup` function that ignores the hostname it is asked about and
 * always answers with `pinnedIp`.
 *
 * Mirrors the dual-signature contract of `dns.lookup`: when the caller passes
 * `options.all = true`, the callback must receive an *array* of
 * `{ address, family }` entries; otherwise it receives the positional
 * `(err, address, family)` tuple. Node 24+ undici, and `net.connect` with
 * `autoSelectFamily`, call with `{ all: true }`, so an array-aware path is
 * required to avoid `ERR_INVALID_IP_ADDRESS` under a pinned agent.
 */
export function createPinnedLookup(pinnedIp: string): PinnedLookup {
  const family = pinnedIp.includes(':') ? 6 : 4;
  return (_hostname, options, callback) => {
    const wantsAll = typeof options === 'object'
      && options !== null
      && (options as { all?: unknown }).all === true;
    if (wantsAll) {
      callback(null, [{ address: pinnedIp, family }]);
    }
    else {
      callback(null, pinnedIp, family);
    }
  };
}

/**
 * Build an undici Agent whose `connect.lookup` always resolves to
 * `pinnedIp`, with the given connect-phase timeout in milliseconds.
 *
 * `AgentCtor` exists so tests can observe the connect options; production
 * callers never pass it.
 */
export function createPinnedAgent(
  pinnedIp: string,
  connectTimeoutMs: number,
  AgentCtor: typeof Agent = Agent,
): Agent {
  return new AgentCtor({
    connect: {
      lookup: createPinnedLookup(pinnedIp),
      timeout: connectTimeoutMs,
    },
  });
}

/**
 * Build a Node `https.Agent` whose `lookup` always resolves to `pinnedIp`,
 * for use as axios's `httpsAgent`. The TLS handshake still uses the URL's
 * hostname for SNI and certificate verification; only the address the socket
 * connects to is pinned.
 *
 * The agent is single-use (no keep-alive), so it holds no sockets once the
 * request completes and needs no explicit cleanup.
 */
export function createPinnedHttpsAgent(pinnedIp: string, timeoutMs: number): https.Agent {
  return new https.Agent({
    lookup: createPinnedLookup(pinnedIp) as unknown as https.AgentOptions['lookup'],
    timeout: timeoutMs,
    keepAlive: false,
  });
}
