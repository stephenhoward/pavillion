import sinon from 'sinon';

/**
 * Builds a stub ActivityPubInterface for driving EventService repostStatus
 * resolution from test inputs.
 *
 * getSharedEventStatusMap returns a SharedEventEntity status map assembled from
 * the supplied event ids; getCalendarIdsForSharedEvent answers per-event
 * calendar lookups. Both are the surfaces EventService consults when resolving
 * authoritative repostStatus, so stubbing them lets a test fully control the
 * SharedEventEntity-first / EventRepostEntity-fallback derivation.
 *
 * @param sharedEventIds - event ids reposted/shared to the calendar.
 * @param statusOverrides - optional eventId -> 'auto'|'manual' map controlling
 *   the resolved status. Any id in sharedEventIds absent here defaults to
 *   'manual'.
 * @param calendarIdsForEvent - optional eventId -> calendarId[] map returned by
 *   getCalendarIdsForSharedEvent; unmapped ids resolve to [].
 */
export function buildMockApInterface(
  sharedEventIds: string[] = [],
  statusOverrides: Record<string, 'auto' | 'manual'> = {},
  calendarIdsForEvent: Record<string, string[]> = {},
) {
  const statusMap = new Map<string, 'auto' | 'manual'>();
  for (const id of sharedEventIds) {
    statusMap.set(id, statusOverrides[id] ?? 'manual');
  }
  const getCalendarIdsForSharedEvent = sinon.stub();
  // Default behavior: return [] for any event id not explicitly mapped.
  getCalendarIdsForSharedEvent.callsFake(async (eventId: string) => {
    return calendarIdsForEvent[eventId] ?? [];
  });
  return {
    getSharedEventStatusMap: sinon.stub().resolves(statusMap),
    getCalendarIdsForSharedEvent,
  } as any;
}
