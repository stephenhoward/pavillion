/**
 * A hand-off between a site view and the router's scroll behavior, so browser
 * Back/forward restores a saved position only once the view is tall enough to
 * reach it.
 *
 * vue-router consults `siteScrollBehavior` one tick after the destination view
 * has mounted — after its `setup` and the synchronous head of `onBeforeMount`,
 * but before any data it fetches has rendered. A view that renders its content
 * asynchronously (discovery fetches its calendar list on every mount) would
 * otherwise have the saved position applied to its loading frame, where the
 * browser clamps it to whatever the short page allows. Such a view calls
 * `holdScrollUntil` synchronously while mounting, with a promise that settles
 * once its content is in the DOM; the scroll behavior takes the hold and waits
 * on it before returning the saved position. Views that render synchronously
 * register nothing and are restored without delay.
 *
 * Focus follows the same constraint. Any future handler that moves focus after
 * an SPA navigation must, on Back/forward, either call
 * `focus({ preventScroll: true })` or wait on the same rendered signal —
 * focusing an element in the loading frame scrolls the window and undoes the
 * restored position.
 *
 * Module-level state is deliberate: there is one router and one window scroll,
 * so there is at most one destination view to wait for.
 */

/** Longest a hold may delay scroll restoration, so a hung request cannot pin the page. */
export const SCROLL_HOLD_MAX_WAIT_MS = 3000;

let pending: Promise<void> | null = null;

/**
 * Register the promise the next scroll restoration waits on, replacing any
 * earlier hold. The stored hold never rejects (vue-router reports a rejected
 * scroll behavior as a navigation error) and settles within
 * `SCROLL_HOLD_MAX_WAIT_MS` regardless of `rendered`.
 *
 * @param rendered - Settles once the view's content is in the DOM
 */
export function holdScrollUntil(rendered: Promise<unknown>): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SCROLL_HOLD_MAX_WAIT_MS);
  });
  const settled = rendered.then(() => undefined, () => undefined);
  pending = Promise.race([settled, cap]).finally(() => clearTimeout(timer));
}

/**
 * Take the registered hold, clearing it so no later navigation waits on it.
 *
 * @returns The hold, or an already-resolved promise when none is registered
 */
export function takeScrollHold(): Promise<void> {
  const hold = pending ?? Promise.resolve();
  pending = null;
  return hold;
}
