/**
 * Pinned-IP undici Agent — the socket-layer DNS-rebinding defence shared by
 * the ICS fetcher and the rel=me page fetch.
 *
 * Callers validate a hostname's resolved addresses first, then build an
 * Agent whose `connect.lookup` always answers with *that* exact IP. A second
 * DNS resolution at connect time therefore cannot redirect the connection
 * to a different (possibly private) address.
 */
import { Agent } from 'undici';

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
      // Mirrors the dual-signature contract of `dns.lookup`: when undici
      // (or any caller) passes `options.all = true`, the callback must
      // receive an *array* of `{ address, family }` entries; otherwise
      // it receives the positional `(err, address, family)` tuple.
      // Node 24+ undici calls with `{ all: true }` for http connects,
      // so an array-aware path is required to avoid
      // `ERR_INVALID_IP_ADDRESS` under the pinned agent.
      lookup: (
        _hostname: string,
        options: unknown,
        callback: (
          err: NodeJS.ErrnoException | null,
          addressOrAddresses: string | Array<{ address: string; family: number }>,
          family?: number,
        ) => void,
      ) => {
        const family = pinnedIp.includes(':') ? 6 : 4;
        const wantsAll = typeof options === 'object'
          && options !== null
          && (options as { all?: unknown }).all === true;
        if (wantsAll) {
          callback(null, [{ address: pinnedIp, family }]);
        }
        else {
          callback(null, pinnedIp, family);
        }
      },
      timeout: connectTimeoutMs,
    },
  });
}
