/**
 * Application mode type: 'web' or 'worker'
 */
export type AppMode = 'web' | 'worker';

/**
 * Checks if the application is running in worker mode.
 * Worker mode is indicated by the presence of the --worker flag in process.argv.
 *
 * @returns true if --worker flag is present, false otherwise
 */
export function isWorkerMode(): boolean {
  return process.argv.includes('--worker');
}

/**
 * Gets the current application mode.
 *
 * @returns 'worker' if --worker flag is present, 'web' otherwise
 */
export function getAppMode(): AppMode {
  return isWorkerMode() ? 'worker' : 'web';
}
