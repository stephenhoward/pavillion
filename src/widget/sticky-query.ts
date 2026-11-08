import type { LocationQuery } from 'vue-router';

/**
 * Query keys that set how the whole widget document renders, rather than what
 * one page of it shows: the forced color mode, the accent color and the
 * display language.
 *
 * The widget reads them only when a document loads (`lang` in app.ts, the
 * other two through `widgetStore.parseConfig` in the router guard), so a page
 * that loads without them falls back to the calendar's configuration and the
 * SDK default. Every link from one widget page to another therefore carries
 * them, so that reloading the page, opening it in a new tab or sharing its
 * link renders it as the visitor saw it.
 *
 * `view` is not among them. On the calendar list it is the visitor's own
 * choice and already rides in the list's query; event detail has no view.
 */
export const STICKY_QUERY_KEYS = ['colorMode', 'accentColor', 'lang'] as const;

/**
 * Picks the sticky keys out of a route query, dropping any that are absent or
 * repeated. Values are passed through unvalidated: the reader of each key
 * validates it, exactly as when it arrived on the current URL.
 *
 * @param query - The current route's query
 * @returns The sticky keys present in the query, ready to spread into a link's query
 */
export function stickyQuery(query: LocationQuery): Record<string, string> {
  const sticky: Record<string, string> = {};
  for (const key of STICKY_QUERY_KEYS) {
    const value = query[key];
    if (typeof value === 'string') {
      sticky[key] = value;
    }
  }
  return sticky;
}
