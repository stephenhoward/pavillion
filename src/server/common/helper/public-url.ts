import config from 'config';

/**
 * Absolute URLs to this instance's own pages, for contexts with no page
 * origin to resolve a root-relative path against (email bodies above all).
 *
 * `domain` is host-only (`config/default.yaml`), so the scheme is supplied
 * here. `https` is the only scheme this instance is ever addressed by:
 * ActivityPub actor IDs, `Calendar.publicUrl` and webhook URLs all mint it.
 * The e2e-only `localhost:3000` default is read back from the testing
 * transport's store and never followed, so there is no dev/http branch.
 * If the scheme ever becomes configurable, this file is the single edit point.
 */

/**
 * The instance origin, with no trailing slash.
 *
 * @returns `https://<domain>`
 */
export function publicOrigin(): string {
  return `https://${config.get<string>('domain')}`;
}

/**
 * Turns a root-relative path on this instance into an absolute URL.
 *
 * @param path - Root-relative path, starting with `/`
 * @returns The absolute URL
 * @throws Error when `path` does not start with `/`
 */
export function publicUrl(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error('publicUrl: path must be root-relative (start with "/")');
  }
  return publicOrigin() + path;
}
