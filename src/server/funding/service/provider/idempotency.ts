import { randomUUID } from 'crypto';

/**
 * Build the idempotency key for one logical provider operation
 *
 * The key names the operation and the local entity it acts on, then appends
 * a nonce minted once per attempt. Mint it once at the service layer and
 * thread the same key through every provider call the operation makes, so a
 * replay of that attempt de-duplicates at the provider while a fresh attempt
 * (a new nonce) is treated as a new operation. The entity id is an internal
 * UUID, never user-entered data, so no PII reaches the provider's key store.
 *
 * @param operation - Stable operation name (e.g. 'plan-cancel')
 * @param entityId - Local id of the entity the operation acts on
 * @returns Key of the form `pavillion:<operation>:<entityId>:<nonce>`
 */
export function buildProviderIdempotencyKey(operation: string, entityId: string): string {
  return `pavillion:${operation}:${entityId}:${randomUUID()}`;
}
