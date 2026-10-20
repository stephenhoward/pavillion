/**
 * A controllable stand-in for window.matchMedia.
 *
 * happy-dom ships a real matchMedia whose answer depends on its own window
 * size, so tests that branch on a media query replace it with this fake and
 * drive the result directly. Every query passed to matchMedia is answered by
 * the same fake MediaQueryList, which keeps the listener count observable.
 *
 * The helper does not register its own afterEach: callers call restore() in
 * their afterEach so the original matchMedia is back before the next file.
 */

type ChangeListener = (event: MediaQueryListEvent) => void;

export interface FakeMatchMedia {
  /** Sets `matches` and fires a `change` event at every registered listener. */
  setMatches(next: boolean): void;
  /** Number of `change` listeners currently registered. */
  listenerCount(): number;
  /** Every query string passed to matchMedia, in call order. */
  queries: string[];
  /** Puts the original window.matchMedia back. */
  restore(): void;
}

/**
 * Replaces window.matchMedia with a fake whose `matches` starts at `initial`.
 */
export function installMatchMedia(initial: boolean): FakeMatchMedia {
  const original = window.matchMedia;
  const listeners = new Set<ChangeListener>();
  const queries: string[] = [];
  let matches = initial;
  let media = '';

  const mediaQueryList = {
    get matches() {
      return matches;
    },
    get media() {
      return media;
    },
    onchange: null as ChangeListener | null,
    addEventListener(type: string, listener: ChangeListener) {
      if (type === 'change') {
        listeners.add(listener);
      }
    },
    removeEventListener(type: string, listener: ChangeListener) {
      if (type === 'change') {
        listeners.delete(listener);
      }
    },
    addListener(listener: ChangeListener) {
      listeners.add(listener);
    },
    removeListener(listener: ChangeListener) {
      listeners.delete(listener);
    },
    dispatchEvent(event: Event) {
      for (const listener of listeners) {
        listener(event as MediaQueryListEvent);
      }
      mediaQueryList.onchange?.(event as MediaQueryListEvent);
      return true;
    },
  };

  window.matchMedia = ((query: string) => {
    queries.push(query);
    media = query;
    return mediaQueryList as unknown as MediaQueryList;
  }) as typeof window.matchMedia;

  return {
    setMatches(next: boolean) {
      matches = next;
      mediaQueryList.dispatchEvent({ matches, media } as unknown as Event);
    },
    listenerCount() {
      return listeners.size;
    },
    queries,
    restore() {
      window.matchMedia = original;
    },
  };
}
