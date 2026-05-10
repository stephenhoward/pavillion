import { EventLocation } from '@/common/model/location';

/**
 * Clone an EventLocation into a detached working buffer.
 *
 * `EventLocation.toObject` intentionally omits `eventCount` (read-only, never
 * round-tripped into writes), so the JSON-shaped clone loses it. This helper
 * reattaches `eventCount` onto matching Space rows so any consumer that keys
 * UI behavior off `space.eventCount` (e.g. the delete-reassign branch in
 * edit-place) survives the staging-buffer hand-off.
 *
 * Lifted from edit-place.vue when the add-space sheet became a second
 * consumer (pv-s6s3.4) — the staged buffer pattern is shared, so the helper
 * lives here to avoid drift.
 */
export function cloneLocationForBuffer(source: EventLocation): EventLocation {
  const clone = EventLocation.fromObject(source.toObject());
  // Patch eventCount back onto each Space whose id matches a source row.
  if (source.spaces && source.spaces.length > 0) {
    const eventCountById = new Map<string, number>();
    for (const sourceSpace of source.spaces) {
      if (sourceSpace.id && typeof sourceSpace.eventCount === 'number') {
        eventCountById.set(sourceSpace.id, sourceSpace.eventCount);
      }
    }
    for (const cloneSpace of clone.spaces) {
      if (cloneSpace.id && eventCountById.has(cloneSpace.id)) {
        cloneSpace.eventCount = eventCountById.get(cloneSpace.id);
      }
    }
  }
  return clone;
}
