# Stakeholder Personas

> Last Updated: 2026-03-22
> Version: 1.0.0

## Purpose

This document defines the stakeholder personas that daily briefings, planning sessions, and prioritization discussions should reference when evaluating opportunities, risks, and priorities. Each persona represents a distinct perspective on how Pavillion creates or fails to create value.

Stakeholders are grouped into three tiers based on how directly they interact with the product.

## Tier 1: Direct Users

These people use Pavillion regularly. Their experience is the primary measure of product success.

### Event Attendee

The person who shows up. They may never know (or care) that Pavillion exists — they just want to find something to do this weekend. They arrive via a shared link, a search engine, or an embedded widget on a community website. They will not create an account and will leave immediately if the experience is confusing or slow.

**What they need from us:** Fast, accessible, multilingual event information with zero friction. No login walls, no cookie banners, no dark patterns.

**Briefing lens:** When evaluating any public-facing change, ask whether it makes this person's experience worse. They are the most numerous stakeholder and the least forgiving.

### Event Organizer

A nonprofit coordinator, small business owner, or community leader who creates and manages events. They chose Pavillion (or were set up on it) because someone in their community championed it. They are not technical and will compare every interaction to the ease of Facebook Events or Eventbrite.

**What they need from us:** An event management experience that feels intuitive and reliable. Clear feedback, simple recurring event setup, media uploads that just work, and confidence that their events are reaching people.

**Briefing lens:** Feature complexity is this persona's biggest risk. Every new option or setting we add is something they have to understand. Prioritize sensible defaults over configurability.

### Community Curator

A city events coordinator, chamber of commerce director, or tourism board manager who aggregates events from multiple calendars into a community-wide view. They are the primary champion for Pavillion adoption in a local area and often the person who convinced their organization to try it.

**What they need from us:** Effective federation tools, content moderation capabilities, and a public calendar experience compelling enough to justify their advocacy. They need to demonstrate value to their own stakeholders (city council, board members, etc.).

**Briefing lens:** This persona lives or dies by the quality of the public calendar experience and the reliability of federation. If federated events break or the public site looks unprofessional, they lose credibility with the people who fund their work.

### Instance Administrator

A systems administrator or community tech lead who runs a Pavillion server. They handle deployment, upgrades, federation configuration, user management, and troubleshooting. They may also be a curator or organizer.

**What they need from us:** Stable releases, clear upgrade paths, good documentation, sensible default configurations, and operational visibility into what their instance is doing (especially federation activity).

**Briefing lens:** Every architectural decision lands on this person's desk. Backend complexity, database migrations, configuration changes, and security patches all flow through them. Minimize operational surprise.

## Tier 2: Ecosystem Partners

These stakeholders don't use Pavillion daily but directly influence its adoption, sustainability, and reach.

### Community Champion

The person who advocates for Pavillion adoption within their organization or community. They may be a curator, an organizer, or a tech-savvy community member. They are the bridge between the project and a potential user community. They attend meetings, write proposals, and answer the question "why not just use Facebook?"

**What they need from us:** A compelling story, a working demo, clear onboarding documentation, and evidence that other communities have succeeded. They also need us not to embarrass them — broken features or confusing UX undermines their credibility.

**Briefing lens:** Adoption depends on this person's ability to sell Pavillion to decision-makers. Marketing materials, landing pages, and first-run experiences should be evaluated through their eyes.

### Fediverse Community

Developers, administrators, and users of other ActivityPub-compatible software (Mastodon, Mobilizon, Lemmy, etc.). They care about protocol compliance, interoperability, and whether Pavillion is a good citizen of the federated web. Some may build tools or integrations that connect to Pavillion instances.

**What they need from us:** Standards-compliant ActivityPub implementation, responsive handling of federation edge cases, and respectful participation in protocol discussions. They do not want another platform that claims federation support but breaks interoperability expectations.

**Briefing lens:** Federation bugs or protocol deviations risk reputational damage in a community that values interoperability. When making ActivityPub-related decisions, consider how they would be received on the Fediverse.

### Website Integrators

Web developers and content managers at organizations who embed Pavillion widgets on external websites. They work with the embeddable widget system and need it to be lightweight, customizable, and reliable.

**What they need from us:** A widget that loads fast, looks good in any context, doesn't break their site's layout, and is easy to configure. Clear documentation and a simple embed code.

**Briefing lens:** The widget is often the first (and only) touchpoint between Pavillion and the broader public. Widget performance and appearance directly affect how organizations perceive the platform.

## Tier 3: Upstream Stakeholders

These stakeholders shape the conditions under which Pavillion is built and sustained. They rarely interact with the product directly.

### Open-Source Contributors

Developers who contribute code, documentation, translations, or bug reports. They may be motivated by the mission, by professional development, or by needing a feature for their own community's instance. They interact primarily with the codebase, issue tracker, and development processes.

**What they need from us:** A well-organized codebase, clear contribution guidelines, responsive code review, good test coverage, and a welcoming community. They should be able to pick up an issue and make progress without extensive hand-holding.

**Briefing lens:** Contributor experience is a leading indicator of project health. If the codebase is hard to navigate, tests are flaky, or PRs sit unreviewed, contributions will dry up. Evaluate architectural decisions for their impact on contributor onboarding.

### Local Government and Institutional Decision-Makers

City council members, municipal IT directors, tourism board executives, and nonprofit board members who authorize budgets and approve technology adoptions. They care about reliability, data sovereignty, accessibility compliance, and whether the platform aligns with their community's values and policies.

**What they need from us:** Security, compliance, data ownership guarantees, and a track record of reliability. They need to feel confident that adopting Pavillion is a defensible decision.

**Briefing lens:** A single security incident or data loss event could kill adoption across an entire category of institutional users. Evaluate risks through the lens of "would a city IT director be comfortable explaining this to their council?"

### Accessibility Advocates

Community members, disability rights organizations, and compliance reviewers who evaluate whether Pavillion meets accessibility standards (WCAG). They may not use the platform themselves but will influence adoption decisions based on accessibility audits.

**What they need from us:** WCAG 2.1 AA compliance at minimum, semantic HTML, proper ARIA attributes, keyboard navigability, screen reader compatibility, and support for users with diverse needs including vision, hearing, motor, and cognitive differences.

**Briefing lens:** Accessibility is not a feature — it's a baseline. Every UI change should be evaluated for accessibility impact. An inaccessible community calendar contradicts the mission of inclusive community building.

## Using This Document in Daily Briefings

When evaluating any opportunity, risk, or priority, consider:

1. **Which stakeholders are affected?** Name them specifically.
2. **What does this look like from their perspective?** A backend optimization matters to the Instance Administrator but is invisible to the Event Attendee.
3. **Are we creating tension between stakeholders?** Adding configuration options helps the Instance Administrator but may overwhelm the Event Organizer. Name the trade-off.
4. **Who is most affected by inaction?** If we don't address a risk, which stakeholder bears the cost?
5. **Does this strengthen or weaken a stakeholder's ability to advocate for Pavillion?** The Community Champion and Community Curator are force multipliers — anything that helps them helps adoption broadly.
