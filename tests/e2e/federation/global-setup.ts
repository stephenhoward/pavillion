/**
 * Federation Global Setup
 *
 * Defensive harness-state reset that runs once before every federation run.
 *
 * `signature_strict_receive.spec.ts` flips beta into strict signature mode
 * (SKIP_SIGNATURES=false) in beforeAll and restores the default in afterAll.
 * Playwright runs afterAll on ordinary test failure, but NOT when the worker
 * is killed by SIGKILL, OOM, or an external CI timeout -- in that case beta
 * stays strict and every subsequent federation run (whose specs assume
 * SKIP_SIGNATURES=true) fails or passes for the wrong reason. Resetting here
 * makes the harness state explicit and recoverable after such a kill.
 *
 * The helper only recreates the beta container when a leaked non-default
 * value is actually detected, so healthy runs pay one `docker compose exec`
 * env check and nothing more.
 */

import { ensureBetaDefaultSignatures } from './helpers/strict_receive';

export default async function globalSetup(): Promise<void> {
  await ensureBetaDefaultSignatures();
}
