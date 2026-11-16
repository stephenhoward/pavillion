import { FEDERATION_HTTP_DEADLINE_MS } from '@/server/common/constants';

/**
 * The two bounds every outbound federation request carries beyond axios's
 * idle `timeout`: a cap on the response body and an overall deadline.
 *
 * Spread the result into the axios config. A request that exceeds either bound
 * rejects like any other network failure, so callers need no new handling.
 *
 * - `maxContentLength` stops a peer streaming an unbounded body into memory.
 *   (axios's `maxBodyLength` guards the request body and is not what this is.)
 * - `signal` aborts the request at the deadline even while the peer is still
 *   sending, which the idle `timeout` cannot do. A fresh signal is created on
 *   each call, so the deadline starts when the request is built.
 *
 * Signing, redirect handling and the private-address check are not part of
 * this and stay with each call site.
 *
 * @param maxContentLength - Largest response body to accept, in bytes
 * @returns Config fragment to spread into an axios request config
 */
export function federationRequestBounds(maxContentLength: number): {
  maxContentLength: number;
  signal: AbortSignal;
} {
  return {
    maxContentLength,
    signal: AbortSignal.timeout(FEDERATION_HTTP_DEADLINE_MS),
  };
}
