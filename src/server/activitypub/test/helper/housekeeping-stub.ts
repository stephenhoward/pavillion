import HousekeepingInterface from '@/server/housekeeping/interface';

/**
 * Returns a minimal HousekeepingInterface stand-in for AP unit tests that
 * construct `ActivityPubEventHandlers`. The real housekeeping dependency is
 * required by the handler constructor (DEC-003 — cross-domain calls go
 * through interfaces, not service imports) but most tests only care that
 * `publishJob` does not crash. Tests that exercise the actual publish path
 * should stub `publishJob` directly with sinon.
 */
export function stubHousekeepingInterface(): HousekeepingInterface {
  const stub = {
    publishJob: async () => undefined,
  };
  return stub as unknown as HousekeepingInterface;
}
