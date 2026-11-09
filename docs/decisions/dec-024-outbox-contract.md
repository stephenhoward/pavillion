# DEC-024: The Outbox Contract

> Date: 2026-11-09
> Status: Accepted
> Category: Technical
> Stakeholders: Tech Lead, Calendar Owners

## Decision

`ap_outbox` holds one row per activity a local calendar's outbox sends, written only by `addToOutbox` (`src/server/activitypub/helper/outbox.ts`). A calendar's **public outbox** — the collection `readOutbox` serves anonymously at `/calendars/:urlname/outbox` — is a subset of those rows, chosen by a stored membership flag and by whether processing succeeded, never by how delivery went.

**1. Membership of a new row.** `is_public` is true when the activity's `actor` equals the anchoring calendar's actor URL (`ActivityPubActor.actorUrl`) **and** its `to` or `cc` names `as:Public` or `${actor}/followers`. A row with no addressing is not public. `isPublicOutboxActivity` decides this once, at insert.

**2. Membership of a row stored before the column existed.** Migration `0050_add_ap_outbox_is_public` backfilled `is_public` with a frozen copy of the rule, `backfillIsPublic`, which differs from rule 1 in two ways: the actor is compared by **path** (`/calendars/<url_name>` of the row's calendar), so a changed instance domain keeps its history; and a row whose `to`, `cc`, `bto`, `bcc` and `audience` are all empty (absent, null, `[]` or `''`) is public, because activities written before public addressing was added on 2026-04-30 carry none and they are the calendar's oldest originals. That clause is **history only** — it never applies to a new row. Anything malformed is not public. The actor is parsed with `URL`, never matched as a substring.

**3. What `readOutbox` serves.** Rows of a public type (`Create`, `Announce`, `Update`, `Delete`) where `is_public` is true, `processed_time` is set, and `processed_status` neither starts with `error:` nor equals `bad message type`, minus any Announce with a recorded Undo. `error:` means processing threw and `bad message type` means the type is unknown: neither was published. `partial:` and `skipped:` are **delivery outcomes** and do not affect membership — a public Create whose delivery to one follower failed is still the calendar's public activity. An unprocessed row has not been validated yet. Every writer sets `processed_status` together with `processed_time`, so a processed row with no status does not occur. The page and its `totalItems` count read the same filter.

**4. `is_public` is a third class of denormalized column** beside the two in [DEC-015 (activity-log routing keys)](dec-015-activity-log-routing-keys.md): a **write-once derived fact of the row's own content**. It is neither a display snapshot nor a routing key. Its source, `message`, is write-once; `is_public` is written only at insert and by migration; a change to the rule is a new backfill migration, never an edit to an existing one; it is read only by `readOutbox`; and it never answers "is this activity visible now". DEC-015's rule 2 holds for it unchanged: it is not a policy surface.

**5. Comparing a row's actor is not the identity re-derivation [DEC-013](dec-013-inbox-authenticated-activity-log.md) forbids.** That ban governs inbound gates, where `actor` is a peer's self-assertion. Outbox rows are produced locally by our own code, so their `actor` is a fact we wrote.

**6. Followers-only rows are public.** A calendar's followers are an audience of a public actor, not a confidentiality boundary: anyone can follow.

**7. Nothing is deleted.** Rows that are not public — chiefly a local editor's Update or Delete on a remote calendar, signed by the user actor and anchored on a local calendar's outbox — stay in `ap_outbox`, unserved (retention is pv-crcp). The filter closes **pull** exposure only: the remote calendar still receives the editor's actor URI by POST, and peers keep any copies they took from the outbox before this change.

**8. Rules that must be re-read together.** A feature that renames a calendar (`setUrlName`, [DEC-018](dec-018-root-calendar-urls.md) rule 4) changes the actor URL rule 1 compares against while stored rows keep the old one, so it must revisit membership. Widening the type filter (pv-owy4, e.g. serving Undo) must re-read rule 3. A new reader of `ap_outbox` that serves anything anonymously must apply rule 3, not re-derive it.

## Context

The public outbox used to serve every public-type row whose `processed_status` was exactly `'ok'`. Two defects followed. A public activity whose delivery to one unreachable follower failed ended `partial:` and vanished from the outbox, so a new follower's backfill walk never saw it. And the filter did not look at who the activity was from: `FederationPublisher` anchors a local editor's Update to a remote calendar on a local calendar's outbox, signed by the editor's user actor and addressed only to that remote calendar, and the public outbox served it to anyone — disclosing the editor's actor URI.

## Alternatives Considered

1. **Filter at query time on the stored JSON.** Rejected: the rule needs JSON predicates on the actor and the addressing fields that differ between SQLite and PostgreSQL, and filtering on them would stop the page query being a backward scan of `idx_ap_outbox_calendar_message_time`.
2. **Mark rows with no addressing as not public in the backfill too.** Rejected by ruling: it would remove every calendar's oldest originals from its outbox.
3. **Purge the stored user-actor rows.** Rejected by ruling: an open retention question, and a destructive migration.
4. **Compare the actor with the calendar's current actor URL in the backfill.** Rejected: a changed instance domain would drop a calendar's whole history.

## Rationale

A stored flag keeps the page query on its index (the filter columns are checked on the heap rows the index returns) and makes the rule something a test can pin on both dialects. Deciding membership from the activity's own actor and addressing, rather than from delivery status, makes the outbox say what the calendar published, which is what followers' backfill walks and FEP-8a8e consumers ([DEC-014](dec-014-create-original-announce-repost.md)) read it for. Keeping the backfill's extra clause out of the live rule means an unaddressed activity written from now on is a bug that stays private, not one that is published.

## Consequences

**Positive:**
- A public activity stays in the outbox whatever its delivery outcome, and `totalItems` agrees with the pages.
- User-actor activities anchored on a calendar's outbox are no longer served anonymously.
- The page query still uses `idx_ap_outbox_calendar_message_time`.

**Negative:**
- Membership is frozen per row. A rule change, or a calendar rename, needs a backfill migration to reach stored rows.
- Two copies of the rule exist, the live one and the migration's frozen one; a shared case table (`src/server/activitypub/test/helper/public-outbox-activity.test.ts`) pins where they agree and labels the two places they differ.
- Exposure that already happened is not undone: peers that walked an outbox before this change keep the user-actor activities they took.
