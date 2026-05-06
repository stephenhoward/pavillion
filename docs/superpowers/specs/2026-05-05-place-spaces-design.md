# Spaces (Sub-Locations) Within Places

> Date: 2026-05-05
> Status: Design — ready for implementation planning
> Scope: backend domain model, ActivityPub federation, frontend picker and display

## Problem

A naming convention has been emerging in dogfooded calendar data where the room or sub-area at a multi-room venue gets baked into the Place name: "Convention Center — Pacific Room", "Convention Center — Council Chambers", "City Hall — Council Chambers". This produces:

- **Address duplication** — every room of the same building is its own Place record, redundantly storing the same address fields.
- **Lossy naming** — venue and sub-area are flattened into one untranslated string.
- **Coarse-grained accessibility** — `EventLocationContent.accessibilityInfo` mixes building-wide facts ("accessible parking, ramped entrance") with room-specific facts ("hearing loop, third floor with elevator access") in a single blob, with no way to attribute either part to the right scope.

The convention is a signal that the model is missing a sub-entity. Real venues — a community center with named meeting rooms, a park with named outdoor sub-areas, a campus building, a fairgrounds with multiple stages — generate this pattern naturally.

## Decision

Introduce **`EventLocationSpace`** (user-facing label: "Space") as a translatable child entity of `EventLocation` (Place). A Place has zero or more Spaces. A Space lives inside exactly one Place, has its own translatable name and accessibility content, and otherwise inherits all venue-level information (address, country, etc.) from its parent.

"Space" rather than "Room" because the concept generalizes beyond indoor rooms — gazebos, plazas, fairgrounds stages, the patio at a coffee shop. Same data shape, broader reach.

## Domain Model

### `EventLocationSpace` (new)

`src/server/calendar/entity/location_space.ts` and `src/common/model/location.ts`:

- `id: UUID`
- `placeId: UUID` — FK to `EventLocation.id`, required. Cascade is handled at the service layer (see "Cascade and Validation" below) to match the existing `LocationsService.deleteLocation` convention.
- `_content: Record<string, EventLocationSpaceContent>` — translatable

Validity: a Space requires at least one content row with a non-empty `name` in some language. Same shape as `Calendar` validation.

### `EventLocationSpaceContent` (new)

- `language: string`
- `name: string` — sub-area name in this language ("Pacific Room", "Salle Pacifique", "the gazebo")
- `accessibilityInfo: string` — room-specific accessibility facts in this language

Mirrors `EventLocationContent` shape, with the additional `name` field. Both fields per-language.

### Place name translation status (out of scope)

`EventLocation.name` remains untranslated for now. Spaces' names are translatable; Place names are not. Inconsistency acknowledged. Promoting Place name to translatable is deferred to a follow-up bead — it's a separate refactor that touches every existing Place record and every Place display surface.

The federation extension is structured so that this promotion can happen later without a wire-format break (see "Forward compatibility" below).

### Event reference

`EventEntity` adds:

- `space_id: UUID | null` — FK to `EventLocationSpace.id`, nullable. No explicit DB-level `onDelete` rule; the service layer nullifies `space_id` when a Space is deleted, matching the existing `location_id` pattern in `LocationsService.deleteLocation`.

Existing `location_id` (FK to Place) stays unchanged. An event with `(location_id, space_id)` set means "this event is in that Space at that Place." An event with `location_id` set and `space_id` null is a whole-venue event (or a single-Space Place where Spaces don't apply).

`CalendarEvent` model adds `space: EventLocationSpace | null` alongside the existing `location: EventLocation | null`.

### Cross-entity invariant

When both `placeId` and `spaceId` are set on an event create/update, the calendar/event service verifies `Space.placeId === placeId`. Mismatch throws a new `SpaceLocationMismatchError` domain exception; the API handler maps it to `400`. The picker UI never produces a mismatched pair, so this is a defensive backstop for direct API callers and for AP inbound.

### Two-level limit

A Space cannot have child Spaces. Three-level cases (campus → building → room) flatten to a Space named "Building A — Room 101". Extending to N-level nesting is YAGNI.

### YAGNI gates on Space scope

Space carries only `name` (translatable) and `accessibilityInfo` (translatable). Not in scope:
- Space-specific address (Place owns the address)
- Space coordinates
- Space capacity, photos, contact info
- Space-level visibility/ACL settings

Each of these can be added later without breaking the wire format or the domain model.

## ActivityPub Federation

Pavillion already has a `pavillion:*` extension surface in active use on `EventObject` (`pavillion:content`, `pavillion:categories`, `pavillion:series`, `pavillion:schedules`, `pavillion:urlPrompt`). Spaces extend this convention rather than introduce a new one.

### Outbound serialization

The standard `as:Place` `location` field stays as `_buildLocation()` builds it today, with one addition: when a Space is present, `location.name` becomes `${Place.name} — ${Space.name}` in the primary language so non-Pavillion peers see a sensible flattened label. Address is unchanged (always from Place).

Two new top-level keys are added to the `EventObject.toActivityPubObject()` output:

```json
"pavillion:place": {
  "id": "https://instance-a.example/calendars/<urlname>/places/<uuid>",
  "address": "100 Main St",
  "city": "Springfield",
  "state": "OR",
  "postalCode": "97477",
  "country": "US",
  "content": {
    "en": { "name": "Convention Center", "accessibilityInfo": "Accessible parking, ramped entrance" },
    "fr": { "name": "Convention Center", "accessibilityInfo": "Stationnement accessible, entrée avec rampe" }
  }
},
"pavillion:space": {
  "id": "https://instance-a.example/calendars/<urlname>/places/<uuid>/spaces/<uuid>",
  "content": {
    "en": { "name": "Pacific Room", "accessibilityInfo": "Hearing loop, 3rd floor (elevator)" },
    "fr": { "name": "Salle Pacifique", "accessibilityInfo": "Boucle auditive, 3e étage (ascenseur)" }
  }
}
```

Rules:

- `pavillion:place` is emitted whenever an event has any location at all, regardless of whether the Place has Spaces. This means a Pavillion-aware receiver has a single ingestion path: it always reads the extension when present and never has to silently fall back to the lossy flat `as:Place` surface for translatable fields. The flat `as:Place` is purely the non-aware-peer fallback.
- `pavillion:space` is emitted only when the event references a Space.
- `id` URLs are minted from the canonical instance domain. The `domain` component MUST be sourced from server config (`config.get('domain')`), never from `req.host` or any request-derived value — host-header spoofing on the outbound serialization path would let an attacker mint federation identity URLs pointing to an attacker domain. This mirrors the requirement for AP actor URI minting. Identity hint for receiver-side dedup; not yet dereferenceable as standalone AP objects (a future bead may make Place/Space resolvable). Mirrors how `categories` are emitted as public-API URIs today.
- `content[lang].name` carries the Place's name in every language for which the Place has any content. Today, `EventLocation.name` is a single untranslated string at the model layer, so every entry's `name` carries the same string. This wire shape mirrors the Space's `content[lang].name` exactly and stays stable when Place names are later promoted to translatable — only the local storage changes; the wire format is forward-compatible with no breaking transition.
- `content[lang].accessibilityInfo` carries per-language accessibility text from `EventLocationContent.accessibilityInfo`.
- The address fields (`address`, `city`, `state`, `postalCode`, `country`) stay flat and untranslated, matching the current `EventLocation` storage. If addresses are later promoted to translatable, they follow the same path as `name` — move into `content[lang]` without changing the keys consumers already read.
- The extension is **self-contained** — address fields are duplicated from the standard `as:Place.address`. A pavillion-aware receiver reads the extension and ignores the flat surface; a non-aware receiver reads the flat surface and ignores the extension. No split source of truth.
- `accessibilityInfo` (Place and Space) is treated as **public venue metadata, not personal data**. It describes the venue itself (parking, hearing loops, accessible entrances, etc.) and is broadcast to every federated peer that receives an outbound event. This classification is explicit so that future fields needing different handling can be evaluated against it.
- No JSON-LD `@context` namespace registration. The codebase doesn't currently register `pavillion:` as a context prefix for any other extension key, and this design follows the established pattern. Pragmatic, slightly under-spec; a separate cleanup bead can publish a vocabulary URI later if/when we want strict JSON-LD compliance across all `pavillion:*` keys at once.

### Inbound consumption

`EventObject.fromActivityPubObject()` adds an active priority path that mirrors how `pavillion:content` is consumed today:

1. If `pavillion:place` present:
   - Build a structured `EventLocation` from the extension (all translations preserved on the per-language accessibility content).
   - Populate the local single-string `EventLocation.name` from `content[lang].name`. Pick the first available content entry (or, if the calling context can supply a preferred language, use that). Today every entry carries the same `name` string anyway, so the choice is benign; when Place names later become translatable, this loop becomes a real per-language population.
   - If `pavillion:space` also present, build the matching `EventLocationSpace`.
   - Receiver-side service layer dedups against `pavillion:place.id` / `pavillion:space.id` AP URLs (new `origin_uri` columns on `EventLocation` and `EventLocationSpace`, populated for AP-originated records, null for locally-created ones).
2. Otherwise: existing `_normalizeLocation()` path runs unchanged. Single flat Place, no Space. Backward compatible with Mobilizon, Mastodon, Gancio.

### Defensive degradation

If `pavillion:space.id`'s parent path doesn't match `pavillion:place.id`, drop the Space and keep the Place. Same posture as `_normalizeLocation()` already takes for malformed location data — never reject the whole activity over a single bad sub-field. **Log the drop as a structured warning** with `{ activityId, senderDomain, placeId, spaceId }` (structural identifiers only, no content) so admins can distinguish accidental misconfiguration from repeated anomalous patterns. Silent drop is wrong here: a mismatched parent path is not an ordinary formatting error and may indicate a buggy or hostile peer.

If `pavillion:space` is present and `pavillion:place` is absent, drop the Space and fall through to the standard `_normalizeLocation()` path. A Space without parent context can't be reconstructed safely.

### Sanitization

Inbound `pavillion:place.content[lang].{name, accessibilityInfo}` and `pavillion:space.content[lang].{name, accessibilityInfo}` go through the same `stripHtmlTags()` treatment that `_sanitizeContentObject()` already applies to event content. The existing sanitizer's `accessibilityInfo` handling (line 501 of `event.ts`) was already anticipating this. These fields are plaintext at every consumption surface (display, aria-label, federation echo); strip-on-input is the right posture, distinct from the validate-and-reject posture used for markdown/rich-text fields elsewhere in the codebase.

The signature-verification middleware in `activitypub-express` runs before `fromActivityPubObject` is invoked. The dedup-by-`origin_uri` path therefore only sees activities whose sender has been authenticated against the `origin_uri`'s host — an attacker cannot craft an unsigned activity claiming to update an existing Place's content.

### Forward compatibility

When `EventLocation.name` (or the address fields) are later promoted to translatable, the wire format does not change. `content[lang].name` is already the source of truth on the wire; only the local storage representation moves from a single-string column to a per-language map, and the outbound serializer starts producing distinct names per entry instead of repeating the same string. Receivers that already parse `content[lang].name` get the per-language values for free.

Adding new Space/Place fields (capacity, photos) extends `content` without breaking older readers — they ignore unknown keys per JSON-LD norms.

## Picker UX

Implemented in the existing `src/client/components/common/location-picker-modal.vue`.

**Data load:** one API call returns all Places for the calendar with their Spaces inlined.

**Flat list construction:**

- Place with **0 Spaces** → 1 entry: `Place.name`, selecting `(placeId, null)`
- Place with **1+ Spaces** → 1 + N entries:
  - `${Place.name} ${t('place.picker.whole_venue_suffix')}` — selecting `(placeId, null)`
  - `${Place.name} — ${Space.name(lang)}` per Space — selecting `(placeId, spaceId)`

The "(whole venue)" suffix is always shown for multi-Space Places. A per-Place toggle for "allow whole-venue selection" is YAGNI — the cost of one always-present picker entry is much smaller than the cost of an extra configuration field.

**Search/filter:** matches against the rendered display string. Typing "pacific" matches "Convention Center — Pacific Room".

**Selection contract:** picker returns `{ placeId, spaceId | null }`. Backward compatible — callers that only destructure `placeId` keep working.

**Accessibility:** picker entries get an `aria-label` that disambiguates whole-venue from specific Spaces ("Convention Center, whole venue" vs. "Convention Center, Pacific Room") so screen readers don't have to parse the em-dash visual convention.

## Display Composition

**Event detail page (public site):**

- **Header line** — concatenated name in viewer's language via TranslatedModel fallback. Format string lives in i18n: `t('place.format.with_space', { place, space })` → `"Convention Center — Pacific Room"`. Whole-venue events use `Place.name` directly with no suffix; "(whole venue)" appears only in the picker.
- **Address block** — rendered from Place exactly as today. Unchanged.
- **Accessibility block** — two labeled subsections:
  1. **Venue accessibility** — `Place.accessibilityInfo(lang)`. Hidden when empty.
  2. **Space accessibility** — `Space.accessibilityInfo(lang)`. Hidden when empty or no Space.
  3. If both are empty, the entire accessibility block is hidden (matches today's behavior).

The two-section split is intentional: a screen reader user benefits from "the building has X" and "this room has Y" being distinct facts, even when redundant. Don't merge them.

**Event cards / list views (public site):** just the concatenated name. No address or accessibility — those are detail-view content.

**Event editor (logged-in client):** the picker (above) plus the same display rules for the "selected location" preview.

**Place editor (logged-in client):** the existing `edit-place.vue` screen gains a "Spaces" section that lists this Place's Spaces with inline add/edit/delete. Not a new page — it's an additional section in the existing Place editor.

## Cascade and Validation

The existing `LocationsService.deleteLocation` does **not** block on referencing events. It nullifies `event.location_id` for affected events, deletes the Place's content rows, then destroys the Place. The `places-tab.vue` "you have N events at this place" surface is a user-facing confirmation, not a service-layer block. Spaces follow the same service-layer-orchestrated pattern.

**Place deletion** — `LocationsService.deleteLocation` is extended to also tear down Spaces:

1. Update affected events: set `location_id = NULL` and `space_id = NULL` (extends today's single-column nullify).
2. Delete `LocationSpaceContentEntity` rows for any Space whose `place_id` matches.
3. Delete `LocationSpaceEntity` rows whose `place_id` matches.
4. Delete `LocationContentEntity` rows (existing).
5. Destroy the `LocationEntity` (existing).

All steps run in a single transaction. Events end up with both `location_id` and `space_id` nullified — consistent with how Place deletion already strips events of their venue.

**Space deletion** — new `LocationsService.deleteSpace`:

1. Update affected events: set `space_id = NULL`. `location_id` is untouched, so the event becomes a whole-venue event automatically.
2. Delete `LocationSpaceContentEntity` rows for the Space.
3. Destroy the `LocationSpaceEntity`.

Both runs in a transaction. The edit-place Spaces section shows event count per Space and surfaces the consequence in its delete confirmation: "N events will become whole-venue events."

No service-layer block on Space delete (consistent with Place). Losing a Space is a softer change than losing a venue, and a hard block would be a regression in user agency.

## Public REST API

**Event response shape** — strictly additive:

```json
{
  "...existing event fields...": "...",
  "location": { "...EventLocation.toObject()..." } | null,
  "space": { "...EventLocationSpace.toObject()..." } | null
}
```

The existing `location` shape doesn't change. Non-aware clients keep working; aware clients can opt into reading `space`.

**Spaces admin endpoints** — nested under their Place, since Spaces have no identity outside a Place:

- `GET /api/v1/calendars/:urlname/places/:placeId/spaces` — list
- `POST /api/v1/calendars/:urlname/places/:placeId/spaces` — create
- `GET /api/v1/calendars/:urlname/spaces/:spaceId` — read
- `PUT /api/v1/calendars/:urlname/spaces/:spaceId` — update
- `DELETE /api/v1/calendars/:urlname/spaces/:spaceId` — delete

Authorization uses the same calendar-editor checks as the existing place endpoints.

## Testing

**Unit (`src/common/test/`):**

- `EventLocationSpace` model: `fromObject`/`toObject` round-trip; TranslatedModel content; language fallback chain; multilingual `name` resolution.
- `EventLocationSpaceContent`: validity (non-empty `name` in some language); `isEmpty`; `accessibilityInfo` translation.

**Entity (`src/server/calendar/test/`):**

- `LocationSpaceEntity`: service-orchestrated cleanup on Place delete (Spaces and their content removed); `event.space_id` nullified on Space delete; FK on `place_id` rejects non-matching parent (DB constraint, not service-layer).

**Service (`src/server/calendar/test/`):**

- LocationsService Space CRUD: create, update, delete, validation, mismatch rejection.
- CalendarEvent service: enforces `Space.placeId === locationId` invariant on create/update; throws `SpaceLocationMismatchError` on mismatch.

**API (`src/server/calendar/api/test/`):**

- Space CRUD endpoints: 200/400/404/403 cases.
- Event create/update accepts `spaceId`; returns 400 on mismatch.

**ActivityPub (`src/server/activitypub/test/`):**

- `EventObject.toActivityPubObject` emits `pavillion:place` and `pavillion:space` with full per-language content; whole-venue events emit `pavillion:place` only.
- `EventObject.fromActivityPubObject` consumes the extension with priority over `_normalizeLocation()`; falls back to flat path when the extension is absent (regression guard for Mobilizon/Mastodon inbound).
- Round-trip: serialize → parse → assert structural equality across all translations.
- Sanitization: HTML in `accessibilityInfo` and `pavillion:space.content[lang].name` is stripped on inbound.
- Mismatch defense: malformed `pavillion:space` whose parent doesn't match the reconstructed Place is dropped; Place still ingests.

**E2E (`tests/e2e/`):**

One Playwright scenario covering: create a Place with two Spaces in the editor → create an event picking one Space → public detail page shows concatenated name and layered accessibility blocks → switch event to whole-venue → both blocks render correctly.

## Operational Notes

**No automated migration.** Existing Places that have room names mashed into `name` ("Convention Center - Pacific Room") stay as-is. Pre-launch, the dataset is small enough that the user can manually split them: rename the Place to "Convention Center", create a Space "Pacific Room", reassign affected events through the editor. This is a one-afternoon job — small enough that designing a bulk migration tool would cost more than running the cleanup by hand.

If/when a structured migration tool becomes worth building, it can be a follow-up bead with no impact on this design.

## Out of Scope (Explicit Non-Goals)

- Promoting `EventLocation.name` to translatable. Separate follow-up bead.
- Three-level nesting (Place → Building → Room). Two levels only; flatten if you need three.
- Space-specific address, coordinates, capacity, photos, contact info.
- Making Pavillion's Place / Space resolvable as standalone AP objects (with their own actor URIs and dereferenceable endpoints). The `id` URLs in the federation extension are identity hints; they don't need to resolve in v1. A future bead can promote them to first-class AP objects without changing the wire format.
- Registering a `pavillion:` JSON-LD `@context` namespace. Spaces follow the existing pragmatic prefix convention; if a vocabulary URI is published later, it covers all `pavillion:*` keys at once.
- Bulk migration tool for existing flat-named Places.
- Inbound deduplication tuning (more sophisticated matching beyond `origin_uri` URL equality).

## Decomposition

The work decomposes into two implementation phases that ship together as a single deploy:

1. **Domain model + admin surface** — entity, model, service, REST API, `edit-place.vue` Spaces section, picker update, public detail rendering. Pure local feature; no federation.
2. **ActivityPub federation** — `pavillion:place` / `pavillion:space` outbound emission and inbound active consumption, `origin_uri` columns, sanitization, defensive degradation tests.

Phase 1 and Phase 2 can be implemented in parallel once the schema/model leaves are in place (Phase 2 only depends on the domain model, not on the frontend or REST API). Both phases merge to main together, however — shipping Phase 1 alone would mean any events federated outbound during the gap window lose Space granularity to remote peers (the structured `pavillion:place`/`pavillion:space` keys would be absent), and we want the federation surface to land complete from day one.
