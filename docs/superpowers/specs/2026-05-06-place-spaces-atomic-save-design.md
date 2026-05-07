# Place + Spaces atomic save model

> Status: Design — revised after advisory review (architecture, complexity, consistency, security, testing)
> Date: 2026-05-06
> Related: [pv-ix7v place spaces epic](../../../docs/superpowers/specs/2026-05-05-place-spaces-design.md)

## Problem

The pv-ix7v Place Spaces epic shipped with a save model that prevents Spaces from being added during initial Place creation. The Spaces section in `edit-place.vue` is gated behind `v-if="isEditMode"` (line ~679), and even if shown, `EditSpace` calls `locationStore.createSpace(calendarUrlName, placeId, …)` which requires a real server-side `placeId`. There is no path to create a Place + initial Spaces in one user-facing flow.

The save model is also inconsistent across modes: in create mode the parent Save commits a placeless thing; in edit mode the parent Save commits *only* Place fields, while individual Space saves have already round-tripped independently. There is no single moment where Place + Spaces commit together.

## Goal

A single atomic editor for the whole Place-and-its-Spaces tree. Spaces stage in client-side state while editing; the parent Save commits Place + Spaces in one transaction. Cancel really cancels. Edit mode and create mode use the same model.

## Architectural decisions

### 1. Atomic save (Place + Spaces commit together)

The parent Save button is the only thing that talks to the server for Place data. Adding, editing, or removing a Space stages the change locally; clicking the inline space editor's button does not round-trip. This applies to both create mode and edit mode for consistency.

### 2. Server-side nested write (single transaction)

The Place create/update endpoint accepts a `spaces[]` array and commits everything in one DB transaction. The standalone Space CRUD HTTP routes are removed. The service-layer Space methods stay (still used by the nested service path internally) — only the HTTP surface is gone.

### 3. FK on `events.space_id` set to `ON DELETE SET NULL`

When a Space is deleted, its events automatically become whole-venue events (`space_id = NULL`). This keeps Space deletion atomic with the place save (no two-phase orchestration needed), prevents accidental event loss, and makes "whole venue" the implicit fallback target for reassigns.

### 4. Reassigns happen *after* the place save, as a separate endpoint, without programmatic retry

When the user removes a Space that has events and picks a non-whole-venue target, the reassignment is staged client-side and fires as a follow-up API call after the place save returns. Reassigns to whole-venue are not staged at all (FK SET NULL handles them automatically). If a reassign fails post-save, the editor surfaces a one-time notice ("Place saved. N events couldn't move to [target]; they're on whole venue. Reassign manually from the editor.") and does not retain partial state for programmatic retry. The user can re-open the editor and manually reassign — no automated retry loop, no multi-state save machine.

### 5. Client-supplied `clientId` is a correlation token, not a row ID

New staged Spaces carry a `clientId: <uuid>` field. The server creates each new Space with its own server-assigned UUID and echoes the `clientId` back in the response, so the client can map staged-anchor → real-id and translate `pendingReassigns` targets before firing reassign calls. The server never trusts a client UUID as a row primary key. The server validates that `clientId` is a valid UUID format using `ExpressHelper.isValidUUID()` (or equivalent) and rejects malformed values with 400.

### 6. ActivityPub outbound serialization is unchanged

Per-event AP `Update` activities continue to carry the current `pavillion:place` and `pavillion:space` references, exactly as in pv-ix7v wave 7. Place-level AP activities are not introduced by this change. The Place save changes only what Pavillion stores; what federates is still per-event. Inbound: existing reconstruction from parent payload continues to work without modification.

## API shape

### Place create

`POST /calendars/:calendarId/locations`

```json
{
  "name": "...",
  "address": "...", "city": "...", "state": "...", "postalCode": "...",
  "content": { "en": { "accessibilityInfo": "..." } },
  "spaces": [
    { "clientId": "client-temp-uuid", "content": { "en": { "name": "...", "accessibilityInfo": "..." } } }
  ]
}
```

Response: created Place with `spaces[]` populated. Each new Space row in the response carries `{ id: <server-assigned>, clientId: <echoed> }` so the client can correlate.

### Place update

`PUT /calendars/:calendarId/locations/:locationId`

Snapshot semantics. The `spaces` array is the full intended-after state.

```json
{
  "name": "...", "address": "...", ...,
  "content": { ... },
  "spaces": [
    { "id": "existing-uuid-1", "content": { ... } },        // update
    { "clientId": "client-temp-uuid", "content": { ... } }  // create with server-assigned id
    // any current Space ID not in this list → delete (events → whole-venue via FK SET NULL)
  ]
}
```

Response: updated Place with `spaces[]` populated. New rows include `clientId` echo.

### Place GET (single + list)

Both `GET /calendars/:calendarId/locations` and `GET /calendars/:calendarId/locations/:locationId` eager-load Spaces and serialize them inline as `spaces: [...]`. Each Space includes `eventCount` (a `COUNT(events) GROUP BY space_id` join) so the editor can decide which delete dialog to show.

### Reassign events

`POST /calendars/:calendarId/locations/:locationId/reassign-events`

```json
{ "fromSpaceId": "uuid", "toSpaceId": "uuid" }
```

Bulk-updates `events.space_id` for all events on this Place where `space_id = fromSpaceId`, setting it to `toSpaceId`. (Whole-venue is never the target of this endpoint — events already land there via FK SET NULL when their Space is deleted.) Returns `200` with `{ count: <number> }`.

When `fromSpaceId` has no matching events on this Place — including the case where `fromSpaceId` references a Space on a different Place, or a Space that has been deleted — the response is `200 { count: 0 }`. The endpoint never returns 404 for the `fromSpaceId` not-found case; the `place_id = :locationId` predicate in the WHERE clause is the security boundary, and a non-matching `fromSpaceId` is a safe no-op.

### Removed routes

The following five routes are deleted from `src/server/calendar/api/v1/space.ts` (whole file deleted):

- `POST /calendars/:urlname/places/:placeId/spaces`
- `GET /calendars/:urlname/places/:placeId/spaces`
- `GET /calendars/:urlname/spaces/:spaceId`
- `PUT /calendars/:urlname/spaces/:spaceId`
- `DELETE /calendars/:urlname/spaces/:spaceId`

Federation `id` strings emitted at `src/server/activitypub/model/object/event.ts:884` (form `https://.../places/:placeId/spaces/:spaceId`) are unaffected — those are opaque AP identifiers, not GET handlers.

## Server-side implementation

### Service layer

`LocationService.createLocation(calendar, location: EventLocation)` and `updateLocation(calendar, locationId, location: EventLocation)` retain their existing signatures. The `EventLocation` model gains a `spaces: EventLocationSpace[]` field (see Client-side implementation), so the snapshot rides along on the existing `location` parameter — no new positional argument. Both methods wrap the work in `sequelize.transaction(async t => …)`:

**Create flow:**
1. Insert `LocationEntity` + `LocationContentEntity` rows.
2. For each entry in `location.spaces`: insert `LocationSpaceEntity` (server-generated UUID) + `LocationSpaceContentEntity` rows. Carry the request's `clientId` through the in-memory model so the response can echo it.
3. Reload Place with includes, return.

**Update flow:**
1. Load existing `LocationSpaceEntity` rows scoped by `place_id = :locationId` (the route parameter), not by calendar. This is the security boundary: any incoming Space `id` must match a row in this set.
2. Diff against the incoming `location.spaces`:
   - Incoming row with `id` matching a row from step 1 → update content (replace `LocationSpaceContent` rows for the languages provided).
   - Incoming row with `id` NOT matching a row from step 1 → reject (prevents Space-from-another-Place hijacking, including same-calendar sibling-Place hijacking).
   - Incoming row with `clientId` and no `id` → insert new with server-generated UUID, carry `clientId` through the response model.
   - Existing row whose `id` is missing from incoming → destroy. The `events.space_id` FK with `ON DELETE SET NULL` automatically nulls referencing events.
3. Update Place fields and content.
4. Reload Place with `spaces` (and per-Space `eventCount`) included, return.

All steps run under the same transaction.

### `reassignEvents` endpoint

Single SQL UPDATE inside a transaction:

```sql
UPDATE events
SET space_id = :toSpaceId
WHERE place_id = :placeId AND space_id = :fromSpaceId
```

**Authorization chain (must be verified end-to-end):**
1. `loggedInOnly` middleware
2. Calendar belongs to authenticated account
3. Location belongs to that calendar (use the same middleware/check pattern as the existing place CRUD routes)

**Server validations:**
- `toSpaceId` must reference a Space currently on this Place (`place_id = :locationId`). Reject otherwise.
- `fromSpaceId` is intentionally not validated against the Place's Space set. The `place_id = :placeId` predicate in the WHERE clause is the safety boundary — an out-of-Place `fromSpaceId` matches zero rows and the call returns `200 { count: 0 }`. This is the documented behavior; do not "harden" it by adding a `fromSpaceId in :placeIdSpaces` check, which would change the contract and break the retry-as-no-op idempotency property.
- `toSpaceId` and `fromSpaceId` must be valid UUIDs (`ExpressHelper.isValidUUID()`).

### FK migration

Verify the current `ON DELETE` behavior on `events.space_id`. If not already `SET NULL`, write a migration to alter the FK constraint. Check `src/server/calendar/entity/events.ts` and existing migrations in `src/server/database/migrations/`.

### Permission model

Already enforced at the Place level (caller must own the calendar; location must belong to that calendar). No new authz surface. The reassign endpoint inherits the same chain.

## Client-side implementation

### `EventLocation` common model (`src/common/model/location.ts`)

- `EventLocation` gains `spaces: EventLocationSpace[]` field.
- `EventLocation.fromObject` populates `spaces` from `obj.spaces` (parsed as `EventLocationSpace.fromObject(...)` per entry).
- `EventLocation.toObject` emits `spaces` as `[...spacesArray.map(s => s.toObject())]`.

### `EventLocationSpace` common model

- Gains optional `clientId?: string` (transient correlation token; not persisted; not a row ID — add a doc comment in the type definition stating this).
- Gains optional `eventCount?: number` (read-only computed field returned by the server in GET responses).
- `EventLocationSpace.fromObject` reads `obj.id`, `obj.placeId`, `obj.originUri`, `obj.content`, plus the optional `obj.clientId` and `obj.eventCount` if present.
- `EventLocationSpace.toObject` emits `id` only when set, `clientId` only when set (non-null/non-undefined), and *omits `eventCount` entirely* — it is read-only on the client and never sent in PUT payloads. Use the same conditional-emit pattern as `originUri`.

### `locationStore` shape changes

**Removed:**
- `spacesByPlace` cache state
- `getSpacesForPlace` getter
- `setSpacesForPlace`, `fetchSpaces` actions
- `createSpace`, `updateSpace`, `deleteSpace` actions

**Kept / added:**
- `updateLocation` and `createLocation` accept and return `EventLocation` instances (existing convention). Returned `EventLocation.spaces` carries `clientId` echoes for new entries.
- New action: `reassignEvents(calendarId, placeId, fromSpaceId, toSpaceId)`.

### `LocationService` (client) cleanup

**Removed:** `getSpaces`, `createSpace`, `updateSpace`, `deleteSpace` (their server endpoints are gone).

**Added:** `reassignEvents(calendarId, placeId, fromSpaceId, toSpaceId)`.

**Modified:** `updateLocation` and `createLocation` send `EventLocation.toObject()` (which now includes `spaces[]`); responses parse `EventLocation.fromObject(...)` (which now populates `spaces[]` with `clientId` echoes preserved).

### `edit-place.vue` editor state

```ts
// Single working buffer for the whole tree.
const place = reactive<EventLocation>(initialPlace);

// Reassign decisions made via the delete dialog. ONLY non-whole-venue targets
// land here. Whole-venue choices are not staged — the FK SET NULL handles them
// automatically when the Space is dropped from the snapshot.
const pendingReassigns = reactive<Map<string, string>>(new Map());

// Spaces being edited inline.
const editingSpaceId = ref<string | null>(null);
```

The `isEditMode` gate on the Spaces section is removed — section renders in both modes. Staged Spaces in create mode use their `clientId` as their local key; the parent place create call resolves Place ID and Space IDs in one POST and the response patches local state.

### Save orchestration

```ts
async function save() {
  // 1. One PUT (or POST in create mode) commits Place + Spaces snapshot.
  //    Server creates new Spaces, updates existing, deletes missing.
  //    Deleted Spaces' events automatically become whole-venue via FK SET NULL.
  const result = await locationService.updateLocation(calendarId, placeId, place);

  // 2. Patch local state: replace clientId-anchored entries with their real server IDs.
  const idMap = new Map<string, string>(); // clientId → serverId
  for (const space of result.spaces) {
    if (space.clientId) idMap.set(space.clientId, space.id);
  }

  // 3. Fire pending reassigns sequentially. Whole-venue is never in this map
  //    — those are handled by FK SET NULL during step 1.
  const failures: Array<{ fromId: string; targetId: string; error: unknown }> = [];
  for (const [fromId, toTarget] of pendingReassigns) {
    const realTargetId = idMap.get(toTarget) ?? toTarget;
    try {
      await locationService.reassignEvents(calendarId, placeId, fromId, realTargetId);
    }
    catch (error) {
      failures.push({ fromId, targetId: realTargetId, error });
      // Keep going — collect all failures, do not retain pendingReassigns for retry.
    }
  }

  pendingReassigns.clear();

  if (failures.length > 0) {
    // One-time notice. User can re-open the editor and reassign manually.
    // No retry loop, no retained partial state.
    toast.warning(t('places.error_reassign_partial', { count: failures.length }));
  }
}
```

### `edit-space.vue` inline editor

Stops calling `locationStore.createSpace` / `updateSpace`. Instead emits a `save` event with the staged content payload; parent merges it into `place.spaces` (creating a new entry with a generated `clientId` or updating the existing one in place). Button label changes from "Save" to "Done".

## Editor UX

### Spaces section visibility

Always visible (today only renders in edit mode). Empty-state copy unchanged.

### Inline space editor button labels

`edit-space.vue`: "Save" → "Done", "Cancel" stays.

### Reassign dialog (replaces today's plain confirm when `eventCount > 0`)

> **Remove "[Space name]"?**
> [N] events use this space. Where should they go?
> - ◯ Whole venue *(default)*
> - ◯ A different space: [dropdown of other Spaces in current snapshot, "(new)" suffix on staged-but-unsaved entries]
>
> [Cancel] [Remove Space]

When `eventCount === 0`, today's plain confirm dialog stands.

The dialog only writes to `pendingReassigns` if the user picks a non-whole-venue target. Whole-venue selections close the dialog without staging anything; the Space removal alone is enough to drive the FK SET NULL.

### Dirty-state Cancel/Back prompt

`isDirty = !isEqual(place, initialPlace)`. Whole-venue reassigns are not in `pendingReassigns`, and any non-whole-venue reassign requires a Space to have been removed from `place.spaces` (which `place !== initialPlace` already detects). So the place diff alone is a sufficient dirty signal.

Cancel/Back when dirty → "Discard unsaved changes?" prompt. Without this, the staging model creates a quiet data-loss path.

### Save error handling

Two failure modes:

1. **Place PUT fails** → show error inline at top of editor (today's pattern). Snapshot and `pendingReassigns` stay intact. Save is fully retryable since nothing has been committed.
2. **Place PUT succeeds, one or more reassigns fail** → toast warning ("N events couldn't move; they're on whole venue. Reassign manually from the editor.") and navigate back to places tab. `pendingReassigns` is cleared; events are safely on whole venue. The user re-opens the editor to reassign — no programmatic retry, no retained partial state, no multi-mode error surface.

## Tests

### Unit (server service)

- `LocationService.updateLocation` snapshot diff: creates new Spaces, updates existing, calls `destroy()` on missing rows (verify the call is issued; FK behavior is integration-tested), response model carries `clientId` echo for new entries.
- `LocationService.createLocation` with nested `spaces` array, including `clientId` echo on the response model.
- `reassignEvents`: target validation rejects unknown `toSpaceId`. Note: FK SET NULL behavior and zero-row no-op are integration-tested, not unit-tested, since they require a real database.

### Integration (place API)

- create-with-spaces (`clientId` echo verified end-to-end through the HTTP layer)
- update-with-mixed-CRUD (create + update + delete in one PUT)
- delete-removes-spaces-and-nulls-events (FK SET NULL behavior verified end-to-end against the real database)
- reassign-events endpoint contract — happy path returns 200 with non-zero count
- reassign-events with `fromSpaceId` from a different Place returns `200 { count: 0 }` (documents the scoping invariant; ensures no future "harden fromSpaceId" change accidentally breaks idempotency)
- whole-venue reassign path: delete a Space with events, accept whole-venue default in the dialog, save → `events.space_id = NULL` post-save AND the reassign endpoint is NOT called (this is the architecturally-special no-op case)
- partial-failure recovery: place PUT succeeds, reassign rejected by stub → editor shows toast warning, `pendingReassigns` is cleared, no retry mechanism kicks in
- **Auth tests:** non-owner of the calendar receives 403 from (a) place PUT with nested spaces and (b) the reassign-events endpoint
- Space-hijack rejection: incoming Space `id` from a sibling Place on the same calendar is rejected with 400 (or appropriate status)

### Component (`edit-place.vue`)

- Spaces section visible in create mode
- Staged Spaces show in list with "(new)" affordance
- Parent Save in create mode triggers the store action with the full Place-and-Spaces snapshot (assert on the store action stub's argument shape; the HTTP payload assertion lives at the integration tier)
- After save, post-save rendered state reflects the server response (the persisted Spaces are listed without the "(new)" affordance)
- Cancel discards staged spaces and pending reassigns
- Dirty-state Cancel prompt fires when `place !== initialPlace`
- `clientId`-targeted pending reassign translates to a real server ID after save: stage a new Space, delete an existing Space, pick the new Space in the reassign dropdown, save → the reassign service call receives the server-assigned ID, not the `clientId`

### Component (`edit-space.vue`)

- Clicking Done updates the parent's space list without navigating away (positive behavior assertion)
- Parent receives the staged content via emit
- (Secondary) The inline editor does not call any store/service method directly

### Component (delete dialog)

- Plain confirm dialog when `eventCount === 0`
- Reassign dialog when `eventCount > 0`
- Dropdown excludes the Space being deleted
- "Whole venue" is the default selection
- Picking "Whole venue" closes the dialog without staging an entry in `pendingReassigns`
- Picking a new staged Space (clientId-anchored) writes the `clientId` into `pendingReassigns`; the save orchestration translates it (covered by the `edit-place.vue` test above)

### E2E

- Create Place + 2 Spaces from scratch, save. Open the event picker and assert that both Space names appear as selectable options; the "(new)" affordance is gone.
- Edit a Place, delete a Space with 2 events, reassign to another Space, save. Verify events appear under the target Space in the picker / event list.

### Tests to delete or rewrite

Any test asserting the per-Space CRUD endpoints respond. They're replaced by tests on the nested Place CRUD path.

### Tests deferred to follow-on beads

- ActivityPub regression coverage. The AP outbound serialization is unchanged by Architectural Decision 6, but we will still want a regression test confirming a federated event with a Space reference round-trips correctly through the new save path. Defer this to the AP serialization-verification bead identified in Open Question 1.

## Open implementation questions

1. **ActivityPub serialization verification.** Architectural Decision 6 commits to "no outbound AP changes." Verify by inspecting `src/server/activitypub/model/object/event.ts:884` and any related outbound paths to confirm that the new save path doesn't accidentally emit different AP activities. Add a federation regression test asserting that a Place save with a Space change emits the same per-event Update activity (with the new `pavillion:space` reference) as today's per-Space save would. Defer this verification to a dedicated bead during decomposition.

2. **Inbound federation re-pin behavior.** When a federated event was Space-pinned and the local Space is deleted, the FK SET NULL drops the pin to whole-venue. If the remote instance later re-sends the event with the same Space reference, does the inbound `Update` handler re-set `space_id` (overwriting the local null)? If so, determine whether that is the desired behavior (federation source-of-truth) or whether the local null should be a sticky override (analogous to `RepostDismissalEntity` from DEC-008). Decide during the AP verification bead.

3. **FK `ON DELETE` migration.** Verify current behavior on `events.space_id`; write a migration if not already `SET NULL`.

4. **`eventCount` per Space.** Add a `COUNT(events) GROUP BY space_id` join to the place GET responses (single + list). Document `eventCount` in the model as a read-only computed field.

5. **Picker N+1 cleanup.** `useLocationManagement.ts:65-80` Promise.all-over-places becomes free once `place.spaces` is inline. Verify all picker tests still pass after the prefetch loop is removed.

6. **Bead breakdown.** This change touches server service, server API, client store, two editor components, location model, FK schema, AP federation verification, and tests. Probably wants a small epic with 5–6 beads. The `/shape-spec` workflow should size this properly.

## What gets removed

**Server**
- `src/server/calendar/api/v1/space.ts` — entire router file (5 routes)

**Client**
- `LocationService.getSpaces / createSpace / updateSpace / deleteSpace` (4 methods)
- `locationStore.spacesByPlace`, `getSpacesForPlace`, `setSpacesForPlace`, `fetchSpaces`, `createSpace`, `updateSpace`, `deleteSpace` (7 actions/getters/state)
- `useLocationManagement.ts:65-80` Promise.all-over-places prefetch loop
- `edit-place.vue`: `state.isLoadingSpaces`, `state.spaceEditorOpen`, `state.editingSpaceId`, the post-save `fetchSpaces` calls, the runtime `eventCount` augmentation comment (becomes a real field)
- The retry-on-partial-failure code path described in earlier drafts (eliminated by Architectural Decision 4 simplification)

## Advisory review trail

This spec was reviewed by five advisors before bead creation. All returned APPROVE WITH CONDITIONS; this revision incorporates every condition.

- **architecture-advisor:** AP outbound serialization committed to in Decision 6; partial-failure cancel semantics simplified by Decision 4 revision (no more retry state).
- **complexity-advisor:** Eliminated the retry loop; removed whole-venue from `pendingReassigns`; simplified `isDirty` to a single place-diff predicate.
- **consistency-advisor:** Documented `fromObject`/`toObject` rules for `clientId` and `eventCount`; clarified that `LocationService.updateLocation` keeps its existing signature with `spaces` riding on the `EventLocation` parameter; stated reassign-events `200 { count: 0 }` no-op contract.
- **security-advisor:** Made the Space-hijack validation boundary explicit (`space.place_id = :locationId`, not `calendar.id`); documented the `place_id` WHERE-clause as the `fromSpaceId` safety boundary; required `clientId` UUID-format validation; added inbound federation re-pin to open questions.
- **testing-advisor:** Added auth tests for both endpoints; reframed component test boundary so HTTP payload shape lives at integration tier; strengthened E2E picker assertion; added whole-venue path test; added cross-Place `fromSpaceId` scoping test; added `clientId`-translation full-orchestration test; split FK SET NULL between unit (call issued) and integration (constraint fires); deferred AP regression tests to the AP verification bead.
