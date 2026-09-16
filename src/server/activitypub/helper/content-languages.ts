/**
 * Languages that may contribute an entry to an outbound `nameMap`,
 * `summaryMap`, or `contentMap`.
 *
 * The AS multilingual maps carry exactly two content fields — the name and the
 * description — so the "does this event have 2+ languages of content?" gate in
 * front of them must be computed from those two fields and nothing else.
 *
 * It used to be computed from `CalendarEventContent.isEmpty()`, which answers a
 * different question: does this language row hold *anything at all*. Every
 * content field added to the model since then (accessibilityInfo, imageAlt)
 * widened `isEmpty()` and therefore silently widened the map gate, so a
 * language row carrying only alt text could flip the event from a singular
 * `name` to a `nameMap` — while the map-building loops, which check `c.name`
 * and `c.description`, added no entry for it. The result was a wire-shape
 * change with no content behind it.
 *
 * Membership here is deliberately the same truthiness test the map-building
 * loops use, so "counted toward the gate" and "can produce an entry" stay the
 * same predicate. Adding a content field to the model must not change this
 * function; it changes only if that field becomes a mapped AS surface.
 *
 * @param {Record<string, { name: string; description: string }>} content - The
 *   per-language content rows of the event being serialized
 * @returns {string[]} The language codes with a non-empty name or description
 */
export function mappedContentLanguages(
  content: Record<string, { name: string; description: string }>,
): string[] {
  return Object.keys(content).filter(lang => {
    const c = content[lang];
    return Boolean(c) && Boolean(c.name || c.description);
  });
}
