# DEC-017: Operational Telemetry Exposure

> Date: 2026-08-31
> Status: Accepted
> Category: Technical
> Stakeholders: Tech Lead

## Decision

Pavillion exports operational telemetry — backup, disk, database, media and job-queue health — as a scrapeable, tool-neutral OpenMetrics surface. Five rules bound that surface.

**1. Private by default is a property of the endpoint, not of a proxy or a network.** The exposition is served by a **second HTTP listener on a port that compose never publishes**, separate from the application's main listener. Nothing about that privacy depends on a proxy rule, a firewall, or a network topology: it holds identically in the bundled-Caddy (`standalone` profile) deployment, in a bring-your-own-proxy deployment, and on a bare `docker compose up` with no proxy at all. The main listener carries no metrics route, and the unauthenticated `/health` on it stays **liveness only** — up or not up, no per-check detail. The listener binds `0.0.0.0` inside its container; the boundary is compose non-publication, not the bind address.

Two framings were considered and **rejected**: that a Caddyfile blocker keeps a main-listener `/metrics` private, and that an "internal container network" separates the app from the host. Both are factually wrong about this deployment (see Context) and both make privacy a property of configuration an operator can lose without noticing.

**2. No monitoring stack is bundled or mandated.** The endpoint is the contract; the scraper is the operator's choice. Pavillion ships no Prometheus, no Grafana, no agent, and no compose service for any of them. Documentation may give one worked example as a companion container joined to the compose project's default network; a worked example is not a dependency, and no metric, alert, or dashboard may be designed for a specific vendor's features.

**3. Series describe the instance's operation, never its audience.** No metric series, label, or help text may be derived from calendars, events, or visitors — no `calendar_id`, no `event_id`, no visitor-derived dimension, ever, and no free-form value that could carry one (job ids, payloads, error text). No label value is ever per-entity or free-form: label values come from fixed sets enumerable in the code, such as the functional queue names, or from static build-time facts. **This rule binds future work**, specifically any request-level metrics: per-route latency and throughput are operational; per-calendar or per-event request counts are audience measurement and are out of bounds. A future bead adding them satisfies this rule or does not ship; it does not re-open it as a scope note.

Every value sourced from the housekeeping domain is read through `HousekeepingInterface` ([DEC-003](dec-003-domain-driven-architecture.md)) — the interface's implementation owns the entity and SQL access, and the metrics listener never reaches past it. The one deliberate exception is the `statfs` of `/app/storage/media`: a raw OS stat of a volume that mounts on the app container, with no Media-domain model behind it, so no `MediaInterface` relay method is invented to carry it. That divergence is justified and named here so it is not read as drift; it does not license a second one. The exposition renderer consumes an explicit, named allow-list of fields and never iterates or serializes a raw interface response, so a field added for some other consumer cannot silently become a public series.

Where a series is derived from a stored snapshot rather than a live read, the snapshot's **own write timestamp is exported as its own series**. [DEC-015](dec-015-activity-log-routing-keys.md) splits denormalized values into display snapshots, whose staleness is a feature, and routing keys, whose staleness is a defect. An alerting signal is neither of those columns, but it shares the second kind's staleness contract: a snapshot that keeps reporting last-known-good numbers after the writer dies is worse than no signal, so staleness must be observable to the scraper.

**4. `pavillion_` is the metric namespace, and documented names are a stable operator contract.** Every series carries the `pavillion_` prefix (`pavillion_backup_*`, `pavillion_disk_*`, `pavillion_db_*`, `pavillion_media_*`, `pavillion_queue_*`, with `pavillion_federation_*` reserved). Once a name is published in the operator guide, renaming or removing it requires a deprecation note in that guide. A metric with no underlying data is an **absent series**, never a defaulted zero.

**5. This is an operational-disclosure boundary, in the [DEC-016](dec-016-health-report-disclosure-boundary.md) family.** What it governs is what the project reveals about its own operation — disk pressure, backup cadence and size, queue health — to whoever can reach the surface. **It is not a [DEC-004](dec-004-privacy-first-public-access.md) matter.** DEC-004 governs anonymous attendee access and attendee data; its vocabulary stays reserved for that. Rule 3 exists precisely so that the telemetry surface never becomes an attendee-data surface and never needs DEC-004's protections applied to it after the fact.

## Context

Operators — including the reference deployment — learn of a failed backup or a filling disk through admin email or container logs. Both channels terminate on the instance being monitored: a dead instance cannot report itself dead. A standard scrapeable surface lets any external monitor watch the instance without the project taking on a monitoring stack.

Three facts about the actual deployment shaped rule 1, and each of them contradicts an intuition that was held before the work started:

- **There is no internal Docker network.** `docker-compose.yml` has no `networks:` key at all. The compose project's implicit default network *is* the boundary; a companion container joins it by name, and nothing is segmented from anything else on it.
- **Caddy is not the only door.** The `app` service publishes `${APP_PORT:-3000}:3000` on the host, and the bundled Caddy sits behind `profiles: ["standalone"]` — it is opt-in. In the default bring-your-own-proxy posture, anything on the main listener is reachable on the host regardless of what any Caddyfile says.
- **The main listener has middleware of its own** — setup-mode handling, an SPA catch-all — that a metrics route would have to be reasoned about against on every future change. A separate listener makes that reasoning unnecessary rather than repeated.

This decision is recorded ahead of the code it governs: the `/health` trim has shipped, but the metrics listener, its port configuration, and the exposition itself land with the endpoint work that follows. The posture binds that work rather than describing it, which is the point of writing it down first.

The public `/health` endpoint was trimmed to liveness-only before this decision was written, removing a per-check breakdown that told an anonymous caller which subsystem was failing. That change and this decision are the same posture applied at two points: the public surface says the instance is up and nothing else; the detail lives on a surface that is not public.

The posture recorded here was settled during design and lived only in bead fields. Bead storage (`.beads/**`) is gitignored, which [DEC-016](dec-016-health-report-disclosure-boundary.md) already identified as load-bearing for disclosure — a fresh checkout would have had no record of any of this. A later proposal to "just add the route to :3000" or to "bundle Grafana so it works out of the box" needs a file in the repository to collide with.

## Alternatives Considered

1. **Serve `/metrics` on the main listener, kept private by a Caddyfile route blocker and an internal network**
   - Approach: one HTTP listener; deny the path at the proxy; rely on container networking to keep the app itself unreachable.
   - Pros: no second listener, no extra port, no new configuration; the familiar single-server shape.
   - Cons: rests on two premises this deployment does not satisfy — there is no internal network, and Caddy is an opt-in profile in front of a host-published port. In the default posture the route would simply be public. Even where a proxy is present, privacy becomes a property of a config file that an operator can edit, replace on upgrade, or swap for a different proxy entirely, with no test that fails when they do.

2. **Bundle a monitoring stack in `docker-compose.yml` (Prometheus + Grafana, profile-gated)**
   - Pros: turnkey for a non-expert operator; the project could ship dashboards and alert rules that are known to work.
   - Cons: turns a documentation choice into a product dependency — versions to track, CVEs to triage, a config surface to support, and resource cost on small instances. It imposes a vendor on operators who already run monitoring and would then run two. The value being delivered is a standard surface, and a standard surface is exactly what does not need a bundled consumer.

3. **Expose metrics on the public listener behind a shared token**
   - Pros: keeps one listener and one port; the operator can scrape from anywhere without touching networking.
   - Cons: makes a self-hosted deployment responsible for distributing and rotating a secret, and makes the surface public-with-a-password rather than not-public — a leaked or default token is an exposure with no signal that it happened. An unpublished port reaches default-private with no secret to manage. An operator who wants remote scraping can still put authentication in front of it deliberately; that is a choice they make, not a credential the project hands every deployment.

4. **Leave the posture in bead fields and the operator guide** (the pre-decision state)
   - Pros: no new file; the guide reaches the audience that acts on it.
   - Cons: `.beads/**` is gitignored, so the rationale is invisible to a fresh checkout, and a guide teaches operators what to do without constraining what the project may build next. The content boundary in rule 3 in particular is a constraint on future features, and a constraint that lives only in a closed bead is not a constraint.

## Rationale

**Why the endpoint, not the perimeter.** A property of the code holds in every deployment shape and can be asserted by a test — the endpoint work ships compose structure tests asserting that no metrics port is published, and an integration test asserting that the main listener has no metrics route. A property of a proxy config holds only where that proxy is present and unmodified, and it fails open silently. Given a host-published app port and an opt-in proxy, the perimeter framing was not merely weaker; it was wrong.

**Why no bundled stack.** Every operator's monitoring is already decided by their infrastructure. Shipping one imposes a choice, adds a support and security surface the project did not need, and helps only the operator who has none — who is better served by one worked example in a guide they can adapt than by a service in the compose file they must now maintain or remove.

**Why the content boundary is drawn at the schema.** Metrics are scraped by systems outside Pavillion's control and retained there indefinitely, at whatever granularity the scraper chooses. Access control on the endpoint does not travel with the data; the schema does. So the rule is that audience-derived values are never in a series in the first place, rather than that they are protected once they are. This is also why the rule must bind future request-level metrics explicitly: per-route latency is a statement about the instance, while a per-calendar request counter is an attendance record that would exist nowhere else in the system, exported to a third-party store, for a product whose entire premise is that no such record is kept.

**Why namespace stability is a contract.** Metric names end up in alert rules, dashboards, and recording rules that live in the operator's repository, not ours. A rename does not produce an error; it produces a series that quietly stops, and an alert that quietly stops firing. That failure mode is the reason a rename costs a deprecation note.

**Why this sits with DEC-016 and not DEC-004.** Both this decision and DEC-016 answer the same shape of question: what may this project reveal about its own internal state, and to whom. DEC-004 answers a different one — what the project may collect and require from the people who read a calendar. Filing telemetry exposure under DEC-004 would dilute a decision whose strength comes from being about attendee data specifically. Rule 3 is the joint between the two: it keeps the telemetry surface permanently outside DEC-004's subject matter.

## Consequences

**Positive:**

- Privacy-by-default is testable and holds in every deployment shape, including ones the project does not ship or document.
- A future "add the route to :3000", "bundle Grafana", or "label the request counter by calendar" proposal has a file in a tracked directory to collide with, rather than a closed bead nobody can read.
- Operators keep their existing monitoring; the project keeps a surface, not a stack.
- The stability contract lets operators write alert rules that survive upgrades.
- The content boundary is stated as a forward constraint, so request-level metrics can be designed later without re-litigating what may be in a label.

**Negative:**

- A second listener is a second thing to configure, start, fail, and reason about at startup, for a surface most operators will never scrape.
- Scraping requires work from the operator — a companion container and a network join — where a bundled stack would have required none. This is the deliberate trade of alternative 2.
- The listener has no built-in authentication: anyone who can reach the port reads it. An operator who publishes the port deliberately owns that exposure, and the operator guide has to carry the mitigation guidance rather than the code enforcing it.
- Genuinely useful product questions ("which calendars are busiest") are foreclosed on this surface. They must be built as authenticated admin features against live data, which is more work than adding a label would have been.
- Metric names constrain refactoring: an internal rename that reaches the exposition layer now costs a documentation change and a deprecation window.
