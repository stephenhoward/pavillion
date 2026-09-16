# DEC-014: Create Means Original, Announce Means Repost

> Date: 2026-08-01
> Status: Accepted
> Category: Technical
> Stakeholders: Tech Lead

## Decision

Pavillion's Event federation distinguishes authorship from redistribution by activity type:

- **A locally-created event federates as `Create(Event)` with the full Event object embedded**, addressed public + `{actor}/followers`, with a deterministic activity id of `{eventUrl}/create` (`events/index.ts` `handleEventCreated`). Local edits federate as `Update(Event)` with the same embedded shape; local removal federates as `Delete` carrying the event IRI.
- **A repost — sharing another calendar's event — federates as `Announce` whose `object` is the canonical event IRI only**, never an embedded object. This is true for both manual shares (`service/members.ts` `shareEvent`) and auto-reposts (`service/inbox.ts` `checkAndPerformAutoRepost`).

Announce is therefore never used to publish an original, and Create is never used to redistribute someone else's event.

Two consequences of the split are load-bearing and must be preserved:

**1. `isOriginal` is derived from attribution, not from wire type alone.** `checkAndPerformAutoRepost(calendar, sourceActorUri, eventApId, isOriginal)` takes `isOriginal` as an explicit argument. On the Create path it is hardcoded `true` — a Create is always authored by its actor. On the Announce path it is computed as `apObject.attributed_to === message.actor`, so a peer that Announces its *own* event (the pre-DEC-014 Pavillion shape, and the shape some non-Pavillion peers emit) is still classified as an original rather than a repost. `isOriginal` then selects the follow policy (`auto_repost_originals` vs `auto_repost_reposts`) and gates the attribution check: originals require `attributed_to === sourceActorUri`, while reposts intentionally allow sharer ≠ author.

**2. Same-instance delivery drives the cascade from the Create path.** `handleEventCreated` writes the `EventObjectEntity` *before* the outbox fans out, so when the in-process dispatch path (`trustLocalOrigin`, see [DEC-013](dec-013-inbox-authenticated-activity-log.md)) re-enters `processCreateEvent` for a same-instance follower, a pre-existing row is **expected and is not a duplicate delivery**. That branch must call `checkAndPerformAutoRepost(..., true)`; it is the Create-path equivalent of the `processShareEvent → checkAndPerformAutoRepost` cascade that carried local originals when they were Announced. Remote re-delivery of an already-known event remains a genuine duplicate and is skipped.

**Inbound content is allow-listed by the receiver; the calendar domain owns the cap.** The content an Event carries — `pavillion:content`, keyed by language — crosses a domain boundary on the way in, and the two halves of making it safe are split deliberately:

- **The ActivityPub layer strips markup and closes the key set.** `EventObject._sanitizeContentObject` is an allow-list (`ALLOWED_CONTENT_KEYS`), not a spread: every key a content entry may carry is named and run through `stripHtmlTags`, and an unnamed key is dropped. The earlier spread is how `imageAlt` first reached the database off the wire with no tag stripping and no bound. Adding a content field to the model is now a deliberate edit here, pinned by a structural tripwire test in `test/model/object/event.xss.test.ts`.
- **The calendar domain owns the length cap**, because the columns are its columns: `EventService` normalizes federated content through `sanitizeImageAlt` on the way into storage. Per [DEC-003](dec-003-domain-driven-architecture.md), ActivityPub reaches the calendar domain only through `CalendarInterface` and has no business asserting a bound on a column it does not own.
- **`sanitizeImageAlt` is a complete normalizer, not the second half of one.** It re-runs the same plain-text normalization `validateImageAlt` performs and then drops (never truncates) an over-long value, so the stored-value invariant holds no matter which path wrote the row — author form or peer. It does not assume the ActivityPub layer already stripped anything. Two independent passes over the same value is the point: neither layer is load-bearing for the other's guarantee, so neither can be broken by an edit to the other.

**The receiver's version decides which content keys survive ingest.** Closing the key set has a federation consequence worth stating outright, in the spirit of [DEC-018](dec-018-root-calendar-urls.md)'s rule that a URL we construct on a peer's domain is a guess about that peer's version: a newer peer emitting a content field an older receiver does not name loses that field silently — it is dropped at `_sanitizeContentObject` with no error, no log line and no signal to the sender. This is correct fail-closed behaviour and it is not to be softened. What follows from it is a rollout fact, not a bug: **a new content field only federates once receivers upgrade**, so a field's first release federates to nobody and back-fills as the network updates. Anything that must reach older peers immediately has to travel on a key those peers already name, and features must not be designed on the assumption that a fresh content key arrives intact.

**The multilingual-map gate counts only mapped content.** `nameMap` / `summaryMap` / `contentMap` appear when 2+ languages have a non-empty *name or description* — the two fields those maps actually carry — computed once in `helper/content-languages.ts` and shared by the Event and the paired Note so the two emissions cannot disagree about whether an event is multilingual. It is deliberately not `CalendarEventContent.isEmpty()`: that answers "does this language row hold anything at all", so every content field added to the model (`accessibilityInfo`, then `imageAlt`) silently widened the gate, and a language row holding only alt text flipped the event from a singular `name` to a `nameMap` while the map-building loops added no entry for it — a wire-shape change with no content behind it. Adding a content field to the model must not change this gate; it changes only if that field becomes a mapped AS surface.

**Paired Note emission is interop-only and outbound-only.** Every Event-typed emission is accompanied by a Note-typed one for Mastodon-class peers that ignore Event activities on profile timelines: `Create(Note)` / `Update(Note)` / `Delete(Note)` alongside the original's activity, and — for a repost — a `Create(Note)` attributed to the *reposting* calendar carrying the remote event's canonical IRI as `urlOverride`. Pavillion never ingests an inbound Note: `processCreateEvent` returns early on `object.type === 'Note'`, because parsing a Note as an Event mints a phantom event that cascades back to the source in mutual auto-repost setups. Both emissions on the repost path sit below the [DEC-008](dec-008-unpost-dismissals.md) dismissal gate, so a dismissal suppresses the Announce and its paired Note together.

## Context

This reverses a status, not just a behavior. Local originals were originally Announced, and epic pv-2p29 carried "Create vs Announce for originals" as *deliberately excluded pending discussion*. The FEP-8a8e alignment work (PR #421) made the call and shipped it, and the rule is now load-bearing across `events/index.ts` and `service/inbox.ts` — but its rationale lived only in a bead note (pv-2p29 policy note, 2026-07-08) and in code comments. Wave 1 and Wave 2 architecture audits flagged that gap; this decision closes it (pv-v20v).

The forcing constraint is FEP-8a8e interop. Event platforms — Mobilizon, Gancio — ingest events from `Create` activities carrying an embedded Event object. An `Announce` whose object is a bare IRI gives such a consumer a URL and nothing else; it must choose to dereference, and event platforms generally treat Announce as a boost of someone else's content rather than as event creation. Announcing our own originals meant Pavillion events did not reliably land as *events* on the platforms Pavillion most wants to federate with.

The second constraint is internal: the follow-policy model already distinguished "auto-repost this calendar's originals" from "auto-repost what this calendar reposts." That distinction had no clean wire signal while originals and reposts shared the Announce shape, so classification leaned entirely on the attribution comparison. Making originals Create gives the common case an unambiguous signal while keeping the attribution check as the authority.

## Alternatives Considered

1. **Announce originals (the pre-#421 behavior)**
   - Approach: every published event, original or repost, federates as `Announce` with the event IRI as object.
   - Pros: one outbound code path; one inbound handler; original/repost classification is uniformly an attribution comparison.
   - Cons: FEP-8a8e event platforms do not ingest Announce-of-Event as event creation, so Pavillion originals fail to appear as events on exactly the peers federation targets. The receiving instance must dereference the IRI to learn anything about the event, adding a fetch (and an SSRF surface) to the common path. Wastes the fact that we already hold the full event at emit time.

2. **Create for both originals and reposts**
   - Approach: reposts also emit `Create` with the embedded object.
   - Pros: a single outbound shape; remote consumers always get full event data without dereferencing.
   - Cons: a repost's Create claims authorship the reposter does not have, corrupting `attributed_to` and defeating the attribution-based loop guard (`attributed_to === localActorUrl`) that terminates mutual-follow and multi-hop cycles. It also erases the original/repost distinction the follow-policy model is built on, and misrepresents provenance to every peer.

3. **Announce with an embedded object for originals**
   - Approach: keep Announce as the single verb but embed the full Event.
   - Pros: no change to inbound routing; full data on the wire.
   - Cons: non-standard — consumers reasonably read Announce's object as a reference and either ignore an embedded body or treat the announcer as the author. Solves the data-availability half of the problem while leaving the "this is not recognized as event creation" half untouched.

4. **Create for originals, Announce for reposts** (Selected)
   - Approach: split by authorship, as described above.
   - Pros: matches how FEP-8a8e peers actually ingest events; the wire form now carries the same meaning as the internal `SharedEventEntity`/`attributed_to` model; no dereference needed for originals; the attribution check remains authoritative so peers that Announce their own originals still classify correctly.
   - Cons: two outbound shapes to maintain, doubled by the paired Note emissions; the same-instance cascade had to move to the Create path, where a pre-existing `EventObjectEntity` row is ambiguous between "local fan-out" and "duplicate delivery" and is disambiguated only by the `trustLocalOrigin` flag.

## Rationale

Authorship and redistribution are different facts, and ActivityPub already has different verbs for them. The pre-#421 shape collapsed both into Announce and then recovered the distinction downstream via an attribution comparison — which worked internally but told remote peers the wrong thing about every original Pavillion published. Matching verb to fact fixes interop and makes the wire self-describing.

Keeping the attribution comparison as the authority — rather than reading `isOriginal` straight off the activity type — is the deliberate part. Federation receives Announce-of-own-original from peers that have not made this split (including older Pavillion instances), and treating those as reposts would apply the wrong follow policy and skip the ownership check that protects the originals path. Wire type is a strong hint; `attributed_to` is the fact.

The `trustLocalOrigin` requirement on the same-instance cascade follows from the ordering in `handleEventCreated`: the `EventObjectEntity` must exist before fan-out so that attribution and loop-guard checks have something to read, which guarantees the row is already there when local dispatch re-enters. Distinguishing that from a real duplicate cannot be done from the row's existence alone, so it is gated on the call-site flag rather than inferred — the same reasoning that gates `actorOwnsObject`'s short-circuit on a flag rather than on a hostname comparison.

## Consequences

**Positive:**
- FEP-8a8e event platforms ingest Pavillion originals as events; the full Event object is on the wire with no dereference required.
- The wire form now matches the internal model: `Create` ↔ authored, `Announce` ↔ `SharedEventEntity`.
- The attribution-based loop guard and the per-follow originals/reposts policy split both keep working unchanged for peers that still Announce their originals.
- The rule is locked by tests: `test/events.test.ts` (`handleEventCreated` writes the `EventObjectEntity` before dispatching paired `Create(Event)` + `Create(Note)`) and `test/integration/outbox-local-dispatch.integration.test.ts` (single-hop auto-repost, multi-hop A → B → C cascade, 2-node and 3-node cycle termination, Announce dedup).

**Negative:**
- Two outbound shapes, each doubled by paired Note emission — four emission sites to keep consistent on any change to Event serialization.
- The same-instance cascade depends on an ordering contract inside `handleEventCreated` (entity written before fan-out) that is not enforced by types. Reordering those statements silently breaks auto-repost for same-instance followers while remote federation continues to look correct.
- Instances that have not upgraded still Announce their originals; both shapes must stay supported inbound indefinitely.
- Inbound Note ingestion must stay off. Re-enabling it without an origin/type check reintroduces the phantom-event cascade that trips federation rate limits under mutual auto-repost.

**Known limitations recorded with this decision** (surfaced by the pv-2p29 and pv-xbq2 audits; all are intentional for v1, not defects):

1. **`eventStatus` is advertised outbound but ignored inbound.** Pavillion has no event-level cancellation state — whole-event removal federates as `Delete`, and per-occurrence cancellation lives in `pavillion:schedules` as `hideFromPublic`. Every serialized event therefore emits `eventStatus: 'EventScheduled'` unconditionally, so peers see the FEP term populated. Inbound, `eventStatus` is tolerated and passed over: a remote `EventCancelled` is intentionally **not** acted on. Closing the asymmetry means routing it through the existing origin-gated privileged-field path (the one that strips `hideFromPublic` when the supplying actor's origin does not match the event's), not just reading the field — which is why it is deferred rather than patched.
2. **The FEP category keyword heuristic is English-only.** Outbound FEP `category` values are derived by matching category names against a keyword table, so a calendar whose categories are defined solely in a non-English language emits no FEP category at all (Pavillion↔Pavillion fidelity is unaffected — `pavillion:categories` URIs still carry it). The keyword table is **frozen**: mis-mapping and missing-mapping reports are the trigger to build the documented replacement — an explicit optional FEP mapping field on `EventCategory` — not to garden keywords. See the maintenance rule in `helper/fep_category_map.ts`.
3. **Image alt text is advertised outbound but not ingested from a remote `Image`.** Two different things get called "inbound alt", and only one of them is a limitation:
   - **Alt inside `pavillion:content.<lang>.imageAlt` *is* ingested.** `imageAlt` is a named key in `ALLOWED_CONTENT_KEYS`, so it is markup-stripped on the way through ActivityPub and capped by `sanitizeImageAlt` on the way into storage, exactly like any other content field. There is no asymmetry here.
   - **Alt on a remote `Image` (its `name` / `nameMap`) is tolerated and *not* ingested.** Outbound, the AS2 `Image` carries the organizer's alt text on the same one-plus-many shape as the event's own title: `name` whenever **any** language has non-empty `imageAlt` (picked primary-language-first, with a first-non-empty fallback), `nameMap` **additionally** when two or more do, and neither key when the image is decorative — an `Image` with no name is the decorative signal on the wire, which a peer should render as `alt=""`. The two keys are not alternatives: emitting `nameMap` alone for a multilingual image would give no alt text at all to a peer that reads only `name` (Mastodon-class), which is the wrong failure for an accessibility feature and inconsistent with how the event's own name reaches those same peers. Alt is read from whichever model supplied the media, so a calendar's default image federates with the calendar's alt. Inbound, none of that is read, for the plain reason that **no remote images are ingested at all** — Pavillion does not copy, cache, or hotlink a peer's media, so there is no local image for a remote description to describe. Consuming inbound `name`/`nameMap` is part of any future remote-image ingestion work and belongs with it, not ahead of it.
4. **Series alt text does not federate.** The outbound series object (`model/object/series.ts`) is an `OrderedCollection` carrying `name` and `description` only — it emits no `Image` — so a series image's alt text, though stored and rendered locally, has nothing to attach to on the wire. Adding it means first deciding whether a series federates an image at all; emitting an alt with no image to describe would be worse than omitting both.
