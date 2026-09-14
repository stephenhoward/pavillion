# DEC-018: Public Calendar URLs Live at the Domain Root

> Date: 2026-09-14
> Status: Accepted (supersedes [DEC-006](dec-006-view-url-namespace.md))
> Category: Technical
> Stakeholders: Tech Lead, Development Team
> Supersedes: [DEC-006](dec-006-view-url-namespace.md) (the `/view/` public-site namespace)

## Decision

A public calendar is addressed at the domain root: `https://<instance>/<calendarName>`. The `/view/` prefix established by [DEC-006](dec-006-view-url-namespace.md) is retired as an address and kept forever as a redirect. Four rules bound the change.

**1. The root is the calendar namespace.** The canonical public calendar URL is `/:calendarName`, with the locale-prefixed twin `/:lang/:calendarName` and the event and series subpaths hanging off both. Discovery — the page that was served at `/view` — moves to its own segment, `/discover` (and `/:lang/discover`), matched tail-tolerantly so `/discover/<anything>` is served the site shell and the SPA decides what to do with the tail, exactly as `/view/<anything>` behaved before. The authenticated client SPA keeps `/` itself and its own top-level segments. **A bare locale root is not one of them:** `/es` and `/es/` 301 to `/es/discover`, and `/en` (or whatever the instance default is) 301s to `/discover`, because a locale prefix addresses no page of its own. Under DEC-006's catch-all those paths loaded the client shell; they are redirect-only now. The site SPA serves everything else at the root that is not reserved. A calendar's url name is therefore its address, not a parameter inside somebody else's namespace, which is what a federated identity that peers, bookmarks and printed flyers all carry should look like.

**2. `/view` is permanently reserved and only ever redirects.** `/view` 301s to `/discover`; `/view/<rest>` 301s to `/<rest>`; both locale-prefixed twins do the same; query strings survive the hop. The segment is never re-issued to a calendar and never routed to a page again. This is the clause that most sharply distinguishes this decision from the one it supersedes: DEC-006 could change the URL shape freely because the product was pre-launch and "no backward-compatibility redirects are needed." That is no longer true, and it is not true in the ordinary way. A `/view/` URL is not only in a visitor's bookmark bar — it has been emitted to other instances as part of ActivityPub objects and to search engines as canonical page metadata. A federated link that 404s is not a broken bookmark a user can work around; it is a hole in another instance's copy of our data, on a machine we do not administer. So the redirect is not a courtesy window with an expiry. It is the permanent second half of this decision, and removing it is a separate decision, not cleanup.

**3. `src/common/routing/reserved-segments.ts` is the single definition of what a calendar may not be named — and it is not a routing table.** Because a calendar occupies a root segment, every top-level segment the product routes is a name a calendar must not hold. That set lives in exactly one module: the server mounts and catch-all exclusions, the client SPA's own top-level routes, `discover`, `view`, and — by delegation to `isValidLanguageCode` rather than by enumeration — every supported locale code. **Adding a top-level route anywhere in the product means adding its segment there**, in the same change; a route added without it is a route that a calendar can shadow.

The module answers one question — *may a calendar claim this name?* — and deliberately refuses to answer a second. Membership means one thing to the validator (reject) and four different things to a router: some segments must not reach the site SPA because the server serves them, others because the client SPA shell does, `discover` is a site SPA route, and `view` is neither, because it redirects. A router consuming the list decides each segment's disposition itself; an alternation built straight from the array would exclude `discover` and `view` from exactly the handler that must serve them. The module's doc comment carries this, and a consumer that wants a routing table builds one deliberately rather than treating this array as one.

Because of that, **reserving the name is necessary but not always sufficient, and what else is required depends on which router owns the segment**:

- **A route served by a domain router mounted in `src/server/server.ts`** — anything registered after the page router, which is every domain's `installHandlers` — must be added to `SERVER_OWNED_SEGMENTS` in `src/server/app_routes.ts` **as well as** to the reserved module. That constant is the subset the server itself answers for, and it is the only exclusion the client catch-all carries. Reserving the name alone stops the segment reaching the site SPA and then hands it to the catch-all, which sits ahead of the domain router and answers the whole subtree — including its 404s — with the client HTML shell. `SERVER_OWNED_SEGMENTS` is a second hand-written list on purpose: the shared module records which names a calendar may not claim, not which router owns a segment, so it cannot supply this. A test asserts every entry is also reserved, which keeps the two from contradicting each other without collapsing them into one.
- **A new client SPA route** needs the reserved module only. The client catch-all is last and serves it by default.
- **A new site SPA route** needs the reserved module plus a route in `src/site/app.ts`, and — if it must win over the `/:calendarName` param route on the server as `discover` does — an explicit server route registered ahead of the derived site routes.

This is the concrete form of "not a routing table". One list says what a calendar may not be called; a router says who answers.

**4. The reservation governs claiming a name, never resolving one.** Reserved-segment checking belongs to the write path — `createCalendar`, `setUrlName`, `createSeries` — and must never gate name resolution. Name-to-calendar resolution gates on the shape rule (`CALENDAR_URL_NAME_RE`) alone. The reason is concrete: an instance that issued a calendar named `feed`, `event`, `discover` or `inbox` before the list existed still has that calendar, and `getCalendarByName` is the single resolver behind the public API, the widget, series and category reads, SSR meta tags and the entire ActivityPub surface. Gating it on the composite rule would have taken that calendar's public page, actor document, WebFinger response and inbound inbox delivery away on deploy, with no remedy available to its owner — a rename they cannot perform on a calendar that no longer resolves. This inverted the intended effect of the rule, was caught in audit during phase 1, and is the single most important constraint this decision carries forward. The operator's signal for pre-existing collisions is the startup report, which names each colliding calendar and says the breakage is coming rather than present; the fix is a deliberate rename before the root routes ship, not an automatic one and not a 404.

What the prohibition covers is **name resolution** — *does a calendar by this name exist?* — and not a **routing disposition** — *which route shape is this path?* The two questions look alike because both take a segment and both happen on a read path, but they have different answers and different consequences for being wrong. A component deciding a disposition is reproducing the router's own table, which necessarily knows the reserved segments, and getting it wrong means rendering the wrong kind of page; `parseEventPageParams` in `src/server/common/helper/meta-tags.ts` is the shipped instance, calling `isReservedRouteSegment` so `/api/events/x` and `/admin/events/x` are not parsed as event pages and SSR meta tags agree with what the router would have served. That is permitted, and its ordering matters — the locale prefix is stripped first, because the predicate answers true for locale codes too. Getting *resolution* wrong, by contrast, means an existing calendar stops existing, which is the failure this rule was written for. So: a routing disposition may consult the reserved list; a resolver may not, and `getCalendarByName` remains on the shape rule alone. Any new caller on a read path has to say which of the two it is.

## Context

DEC-006 moved public calendar URLs from `/@calendarname` to `/view/:calendarName` in February 2026 to stop the `@` prefix colliding conceptually with ActivityPub actor addresses. That reasoning was sound and is not disturbed here: `@` is still not used. What DEC-006 also did, without weighing it, was accept a permanent prefix on the product's most-shared URL.

Three things pushed against keeping it:

- **A calendar's URL is its public identity.** It is the string an organizer prints, reads aloud, and puts in a bio. `pavillion.social/brightonfolk` is an address; `pavillion.social/view/brightonfolk` is an address with a piece of our routing implementation in the middle of it. Every peer platform in this space — Mobilizon, Gancio, and the wider fediverse convention for actor-bearing pages — addresses its public entities at or near the root.
- **The prefix bought a namespace that the reserved-segment work supplies more directly.** `/view/` existed so calendar names could not collide with application routes. A list of forbidden names achieves the same separation without spending a path segment on it, and does so in a form the validator can enforce at creation time — which the prefix never could, since under `/view/` nothing stopped a calendar being named `admin` and nothing needed to.
- **The cost of the move only rises.** Every day of operation adds bookmarks, federated copies and indexed pages carrying the old shape. The change is cheapest now and never gets cheaper.

Phase 1 of this epic (pv-l04s.1) built the foundation the root routing needs: the shared reserved-segment module, its composition into the url-name validator, and a startup report listing calendars that already hold a reserved name. Two corrections during that phase are load-bearing enough to be recorded as rules above rather than left in commit messages — the claim-versus-lookup split (rule 4) and the narrowing of the module's own description so it is not mistaken for a routing table (rule 3). Both were found by audit, not by design, and both are the kind of mistake a future contributor would make again from a clean reading of the code.

This decision is written alongside the route inversion rather than after it, so the URL contract exists in the repository before the code that implements it.

## Alternatives Considered

1. **Keep `/view/:calendarName`** (the DEC-006 status quo)
   - Pros: no migration, no redirects, no reserved-name problem at all — application routes and calendar names live in disjoint namespaces by construction, and nothing can ever collide.
   - Cons: puts an implementation detail in the middle of the product's most-shared string, permanently, for every calendar on every instance. The namespace separation it buys is real but is available another way; the URL ugliness is not recoverable any other way. Deferring also makes the eventual move strictly more expensive as federated and indexed copies accumulate.

2. **Shorten the prefix to `/c/:calendarName`**
   - Pros: keeps the collision-free namespace, shortens the URL, and is a smaller change than the root move — redirects only, no reserved-name machinery.
   - Cons: keeps the structural objection while weakening the one virtue `/view/` had, which was being self-describing. It also spends the migration budget — one round of permanent redirects and one round of federated-link churn — on a cosmetic improvement, leaving the root move still to do later at the same cost plus a second redirect layer.

3. **Return to `/@calendarName`**
   - Pros: root-adjacent and visually marks the segment as an identity, which is exactly what it is; the `@` makes collisions with application routes impossible without any reserved list.
   - Cons: this is the shape DEC-006 removed, and its reasoning stands — `@name` reads as an ActivityPub actor handle, and a Pavillion calendar's actual handle is `@name@instance`. Reintroducing the prefix would re-create the ambiguity DEC-006 paid a migration to remove.

4. **Root URLs with the old prefix serving as well (no redirect, both live)**
   - Pros: zero breakage risk; nothing to get wrong in redirect coverage.
   - Cons: two canonical URLs for one page is an SEO and federation problem rather than a solution — peers would hold whichever copy they first saw, page metadata would have to pick one anyway, and every link generator in the product would need a rule about which to emit. A 301 answers the question once, at the server, for every consumer.

5. **Root URLs with a sentinel that keeps the namespaces disjoint** (a reserved character or a trailing marker on application routes)
   - Pros: root-level calendar URLs with no reserved list and no possibility of a future route shadowing a calendar.
   - Cons: every such scheme puts a character in either the calendar URL or every application URL that has to be explained, typed and survived by copy-paste. It trades a maintenance rule contributors can follow for a permanent oddity every user sees.

## Rationale

**Why the root, given that it is the more constrained design.** The prefix and the root differ in who pays. `/view/` charges every published calendar URL, forever, so that contributors never have to think about route collisions. The root charges contributors a rule — reserve your new top-level segment, and register it with whichever router must answer for it — so that no published URL carries routing vocabulary. The rule is cheap, enforceable in code, and checkable in review; the URLs are not changeable once they are in circulation.

**Why the reserved list is one module and not a scattering of checks.** The failure this guards against is silent: a route added without its segment reserved does not break anything visible until a calendar happens to claim that name, at which point one of them shadows the other in a way that depends on route ordering. A single module gives the rule a place to be tested — including a drift test over the list itself — and gives a code reviewer one file to notice in a diff that adds a route.

**Why membership is not a disposition.** The list's four kinds of member (server-served, client-SPA-served, site-SPA-served, redirect-only) look like one kind from the validator's side and four from a router's. The temptation to build a route regex by joining the array is strong precisely because it would work for most entries; it would silently route `discover` and `view` away from the handlers that exist to serve them. Keeping the module's answer narrow means a router has to write its own dispositions down, where they can be read.

**Why claiming and resolving are different questions.** A validation rule added today describes what may be created today. Data created before it exists is not retroactively invalid — it is data, and it belongs to a user. Applying a creation-time rule at read time converts a policy change into data loss, and the more surfaces a resolver feeds, the less visible that loss is at the point the rule is added: here a one-line validator change would have silently reached WebFinger and inbound federation. The general form is worth stating because the next reserved-name rule will face the same fork: reservations gate writes, and a read resolves on shape. The exception rule 4 carves out does not weaken that, because a routing disposition is not a read of the calendar at all — it decides which page shape a path is before any calendar is looked for, and a wrong answer renders the wrong page rather than deleting an identity.

**Why the redirects are permanent rather than windowed.** A deprecation window works when the holders of the old URL can be counted and told. Here they cannot: the holders include other instances' databases, search indexes, and paper. Permanence also has almost no cost — two redirect rules and a reserved segment — and the alternative is choosing a future date on which other people's copies of our data stop working.

## Consequences

**Positive:**

- Public calendar URLs are as short as the product can make them and contain nothing an organizer has to explain.
- Calendar addresses line up with the shape peer platforms use, which makes a Pavillion calendar read like a first-class fediverse entity rather than a page inside an app.
- Every old `/view/` URL — bookmarked, federated, printed, indexed — keeps working, with the 301 telling search engines and well-behaved peers where the page went.
- What a calendar may be named is defined in one tested module instead of being implied by the route table, so the rule can be asserted rather than remembered.
- The startup collision report gives operators a concrete, actionable list before anything breaks, rather than a support ticket afterwards.

**Negative:**

- **Every new top-level namespace now competes with calendar names.** Adding a route means adding a reserved segment, and adding a reserved segment retroactively forbids a name some calendar might already hold — so each new top-level route carries a small migration question that a route under `/view/`'s regime did not.
- The reserved list also gates series url names, through the same composite validator, so an entry added purely for root-routing reasons silently narrows the series namespace too.
- Instances that already issued a calendar named after a reserved segment need an operator-driven rename. The startup report surfaces them, but the remedy is manual and it is the calendar owner's URL that changes.
- `view` is spent permanently: it can never be a calendar name and never be a page again, which is the price of rule 2.
- The redirect rules and their locale twins are code that must be kept correct forever, with e2e coverage to match, long after anyone remembers what `/view/` was.
- Route matching at the root is inherently more delicate than matching under a prefix: the server must distinguish reserved from calendar segments on the raw pathname, and the two SPAs' route tables now have to agree about which segments each owns.
- A contributor adding a top-level route has two lists and three cases to get right (rule 3), not one rule, and the failure mode of getting it wrong — a domain router shadowed by the client shell, its 404s included — is quiet. `SERVER_OWNED_SEGMENTS` is a duplication that a test constrains but does not remove.
