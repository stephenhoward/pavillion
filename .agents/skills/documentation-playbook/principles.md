# Documentation Voice and Structure Principles

> Version: 1.1.0
> Last Updated: 2026-11-18

This file covers voice, structure, and scope standards for Pavillion user-facing documentation in `docs/guides/`. These standards extend the marketing-site voice (pavillion.social) into reference material — same reader, same values, more depth.

## Who the guides are for

The marketing site names the audience directly: "a nonprofit, a local business, a church, a neighborhood group." Inside the guides, the framing matches — these are people doing real organizing work in their actual communities, not generic users moving through a wizard.

From `docs/guides/calendar-owners/index.md`:

> These guides are for the people running calendars on Pavillion — community organizers, venue staff, neighborhood associations, regional councils, anyone whose job it is to publish events that other people can find.

**Apply this:** Specificity matters. "Users" is a category that doesn't exist in the world. "The neighborhood association down the street" does.

The section index names the reader. A guide inside the section opens with what it covers, and names its reader only when its audience is narrower than the section's. From `docs/guides/contributors/tech-stack.md`:

> This guide covers what Pavillion is built on.

## What the guides are trying to do

Two things at once, in this order:

**1. Teach the software well enough that someone can do the thing.** Without this, none of the rest matters. A calendar owner who can't find the cancel button isn't going to benefit from advice about cancellation etiquette.

**2. Help the reader become a better calendar owner, organizer, or administrator.** The dual-purpose layer. Naming conventions that age, decision aids about which tool fits what, "when not to" framings, troubleshooting wisdom, the social rules of a federated network. This is what distinguishes a Pavillion guide from a feature manual.

The second goal lives *inside* the first, anchored to specific moments of action. **Don't write a sermon called "How to be a good calendar owner" and link to it from each topic.** The advice shows up at the point the reader is actually making the decision — when they're naming a category, choosing between recurrence and a series, deciding whether to repost an event from a neighbor.

## Voice principles

### Address the reader directly

Second person, present tense. "Your calendar," "your community." Match the marketing site's "you put real work into your events" register.

> Most calendars aren't run by one person.

> If your community already has a website — an organization page, a venue site, a project landing page — you can put your Pavillion calendar directly on it instead of asking visitors to click through to a separate URL.

### Lead with the conclusion, then explain

The reader is usually scanning to solve a specific problem. The conclusion goes first; the explanation supports it.

> Nearly always the right call is to cancel — that tells anyone who was planning to attend that the event isn't happening, and that information propagates correctly to any calendar that's reposting from yours. Deletion is useful for a smaller, more specific set of cases.

### Be concrete

Specific examples beat abstract principles. "Riverbend-folk ages better than riverbend-2026-season" lands. "Choose timeless names" doesn't.

> *Riverbend Community Center* is a name your editors will recognize next month and next year. *Main location* or *That coffee shop* won't be — and a co-editor who joins six months from now won't have any idea what those refer to.

### Be honest about limits

Pavillion does some things, doesn't do others, has rough edges. Pretending otherwise undermines trust and wastes the reader's time.

> **Right now, the handle is fixed when you create your calendar.** There's no rename button in the settings panel.

> If you want a permanent snapshot of the original address ... copy that detail somewhere outside Pavillion (the event description, an external doc) before the venue changes. This is rarely worth doing, but worth knowing.

### Name things in the reader's vocabulary

Federation isn't ActivityPub. It's *follow*, *share*, *repost*. The protocol is internal vocabulary; the reader doesn't need it to use the feature.

> Pavillion uses ActivityPub the way email uses SMTP — you don't need to know the protocol to send a message.

Once you have picked the reader's word for something, keep using it. [One term per concept](#one-term-per-concept) lists the terms the guides have settled on.

The same rule applies to internal Pavillion vocabulary that doesn't match what the reader thinks about. The codebase says "funding plan" instead of "subscription" because the latter means a different thing in a federated system; the guides should make that boundary visible without requiring the reader to learn the why.

### Don't preach

The reader is an adult organizing real events. Hectoring them about ethics or best practices reads as condescension. State the practical reason, let them decide.

> Pick something short, durable, and tied to the community rather than to a moment in time.

Not: "It's important to choose names responsibly." The first sentence is advice; the second is a lecture.

### Use warmth without slickness

Conversational and confident, not breezy or branded. The marketing site's "ready to give your community a calendar it deserves?" works there because it's the close. Inside the guides, warmth shows up as treating the reader like a colleague: "you'll know your community's actual buckets better than any generic list."

## Sentence-level rules

The voice principles decide what a guide says. These rules decide how each sentence says it. In the examples, "draft" is a sentence that was edited out of a guide and "edited" is what replaced it.

### Use plain words

Write the word a calendar owner would use in conversation. Words borrowed from software teams, and figures of speech standing in for a plain verb, make the reader translate.

| Draft | Edited |
|---|---|
| once that surface lands | once that feature arrives |
| a short orientation before the mechanics | a note before we dig in to the details |
| a domain folder has the same shape every time | each domain folder uses the same structure |
| once events have flown | once events on your server have reached a peer |
| if your shop doesn't run Docker | if your organization doesn't run Docker |
| see … for how that lands | see … for how that works |
| these guides don't teach it | that is outside the scope of these guides |
| It starts as Pavillion's orange. | The default is Pavillion's orange. |

Check a draft for *surface*, *lands*, *shape*, *mechanics*, *shop*, and *teach* said of a guide.

### End on the fact

Cut aphorisms, slogans, and sentences that restate why something matters. If a paragraph is complete without its last sentence or clause, remove it.

| Draft | Edited |
|---|---|
| A backup you haven't tested isn't a backup. This is the most-skipped piece of admin work… | Backups are the most-skipped piece of admin work… |
| …see the same record they always did; nothing rewrites the past. | …see the same record they always did. |
| If it is, embed — the calendar meets people where they are. | If it is, embed. |
| `## Two steps, on purpose` | `## Two steps` |

### Say what a thing is

State the positive fact. A sentence built as "not X but Y", or "closer to Y than to X", makes the reader take in something untrue before reaching what is true.

| Draft | Edited |
|---|---|
| closer to how public radio funds itself than to a paywall | similar to how public radio funds itself through volunteer contributions |
| If an event just isn't a fit for your calendar, don't report it; not publishing it is the right response. | If an event just isn't a fit for your calendar, just pass it by. |

Keep a contrast when the reader is likely to arrive with the wrong idea. "A file is a snapshot, not a connection" stays in the ICS import guide, because a reader who has just used a feed expects a file to sync too.

### Leave out what the reader won't run into

Tell the reader what to do and what happens next. Leave out how Pavillion works underneath, the reason a form refuses an input the reader had no cause to try, and a trailing clause that repeats the sentence before it.

- Cut: "Because that public address puts your handle at the root of the domain, it can't be a name the instance already routes there…" The form refuses those names, so the reader finds out while choosing.
- Cut: "You can't prove you own `calendar.google.com`, so a live feed from one of those won't verify — but you don't need it to." The next sentence already tells the reader to export a file.
- "…that publishes it again, overriding the prior unpublish, and the event is back on your calendar" became "…that publishes it again, overriding the prior unpublish."

### Write whole sentences

Give each sentence its subject and verb. Join clauses with *and* or *but* where a draft uses only a comma or a semicolon. Where a sentence tells the reader when to use something, write it as an instruction.

| Draft | Edited |
|---|---|
| If yes, recurrence. | If yes, use recurrence. |
| Easier to keep the start date and the weekday selection consistent. | It's easier to keep the start date and the weekday selection consistent. |
| The friction is small, the payoff compounds. | The friction is small, and the payoff compounds. |
| Recurrence is for the same event happening on a predictable schedule | Use recurrence when the same event happens on a predictable schedule |
| You need to own the calendar. | To start a funding plan for a calendar, you need to be the calendar owner. |

### Name the noun

When a sentence refers back to something, say what it is.

| Draft | Edited |
|---|---|
| The first time you visit, the list is empty. | The first time you visit, the editor list is empty. |
| the preview shows your default | the preview shows your default image |
| fine if it gives you the same | fine if it gives you the same safety |
| There's a short decision aid further down. | There's a short decision aid further down this page. |

### One term per concept

Pick one word for each thing and use it every time. A second word reads as a second thing. Where the screen has a label, use that label, in headings as well as prose: the section "Publish an event by hand" became "Repost an event by hand" because the button says **Repost**.

| Use | Not | For |
|---|---|---|
| follow | track | Your calendar's relationship with another calendar |
| repost | publish | Putting a followed calendar's event on your own calendar. "Publish" stays the word for your own events. |
| feature | surface | A part of the product |
| default date range | default date filter | The window of dates your public page lists |

`follow-and-repost.md` still says "publish" for reposting in places. Use "repost" in new and revised text.

Spelling is US English: *gray*, not *grey*. Prefer terms that don't assume a gender: the backup rotation is *grandparent-parent-child*, not *grandfather-father-son*.

### State what you have checked

Open the app and confirm each label, position and default before writing it down. Leave out a default the guide would have to keep in step with the code, absolute words such as *forever* unless the code guarantees them, and general claims you have no evidence for.

- "A live preview beside them" was corrected to "below them".
- "**Schedule 1** block" was corrected to "**Schedule** block".
- Cut: "once you create the first one, the route returns 404 forever."
- Cut: "two weeks unless you've changed it."
- Cut: "Most review feedback on first pull requests comes back to one of those rules."

## Patterns we use

### `::: tip <Lightbulb /> A note on X.` callouts

The vehicle for advice that sits beside instructions. Use these for:

- Naming conventions ("a note on URL names")
- Forward-looking warnings ("a note on shortening the end of a recurrence")
- Scope clarifications ("a note on the first month")
- Acknowledging an edge case the prose doesn't fit

**Don't use them for instructions.** The body of the doc is for instructions; the callout is for the *aside*.

### "Things that trip people up" sections

A short list of failure modes that aren't obvious from reading the rest of the guide. Place at the end of a topic. Keep each item to a sentence or two.

This section earns its keep when the items are *non-obvious*. If every item is a recap of something explained earlier, cut the section or trim it. Examples of items that work:

> **Changing the start time of an already-published recurring event.** If your Tuesday meeting was 7pm and you change the schedule's time to 8pm, *every* future occurrence shifts to 8pm — including ones that were already on the public page.

> **Picking a weekday that doesn't include the start date.** A weekly schedule that starts on a Tuesday but only checks Monday in the recurrence panel will skip the first Tuesday entirely.

### Decision aids

When two features could solve the same problem, the guide should name the choice and give a quick test. Don't make the reader infer it.

> The quick test: would the title field be the same on every occurrence? If yes, recurrence. If you'd want to change the title — even slightly — for each occurrence, the recurrence editor will fight you, and a series is what you actually want.

### "When to use" and "When not to use" framings

A guide that only documents the affordance is incomplete. Most features have a no-go region — events without a place, categories that don't earn a row in the filter, rooms that don't differentiate. Name both regions.

> **No:** a venue with a single usable space, even if you reuse it constantly. A coffeeshop with a tiny back room you've used once.

### Concrete example pairs

When teaching a judgment call, give one example of "yes" and one of "no" so the contrast does the work.

> *Riverbend Community Center* — yes. *Main location* — no.

> *Concert*, *Workshop*, *Volunteer days* — yes. *Acoustic Folk Concert*, *Indie Rock Concert*, *Open Mic Night* — too granular.

## Things we avoid

### Marketing fluff inside reference material

The marketing site sells the platform. The guides help someone use it. A guide that opens with "Pavillion empowers communities to..." is wasting the reader's first paragraph. Open with the topic.

### Documenting the screen at button-label depth

UI guidance is appropriate. UI walk-throughs that name every button, panel, and dialog title overshoot. Document the principle and the consequential choice; let the reader read the screen for the rest.

Compare:

> A confirmation modal opens — *Cancel this instance?* — with a **Hide from public** toggle and two buttons: <Btn>Cancel</Btn> (dismiss the modal) and <Btn>Cancel instance</Btn> (confirm).

vs.

> The confirmation that opens has one decision worth thinking about — a **Hide from public** toggle:

The second still tells the reader what to look for. It doesn't pretend the buttons need names.

### Saying the same thing twice

The decision aid for series-vs-recurrence used to appear three times across two files. Once is enough; cross-link the rest. If you find yourself restating something already covered, link instead. The same applies inside a paragraph — see [Leave out what the reader won't run into](#leave-out-what-the-reader-wont-run-into).

### Hypothetical hedging

"You might want to consider..." "Some users may prefer..." These are hedges that protect the writer at the cost of the reader. Take a position. If the answer truly depends, say what it depends on.

### Jargon-first explanations

ActivityPub, federation primitives, OAuth, ICS — these are real words and they appear in the guides where the reader needs them. They don't appear in the *first sentence of a topic*, where the reader is still orienting.

### Process for its own sake

Steps that don't change the outcome ("first, plan your category vocabulary by writing it on paper before opening the editor") read as filler. If a step exists, it should be load-bearing — skipping it should produce a worse result, and the guide should be willing to say what that result is.

## Continuity with the marketing site

The guides should read like the same project wrote them, with the register adjusted for the form. Common ground:

- **Specific reader.** Marketing names "a nonprofit, a local business, a church, a neighborhood group." Guides name "community organizers, venue staff, neighborhood associations." Same person.
- **Anti-extractive framing.** Marketing: "isn't a product." Guides treat federation as something the reader controls, not something done to them.
- **Effort respected.** Marketing: "you put real work into your events." Guides assume competence and seriousness.
- **Practical outcomes.** Marketing: "more people see your events, with less standing in the way." Guides: "the next job is getting it in front of the people it's for."

Where they differ:

- **Marketing closes with a CTA.** Guides close with "what next" links and an honest read on what the doc didn't cover.
- **Marketing speaks at the platform level.** Guides speak at the calendar level — the work the individual reader is doing.
- **Marketing can be aspirational.** Guides have to be true. If a feature has a foot-gun, name it.

## Notes on length and scope

A guide is the right length when its sections each earn their space. Long isn't bad; padded is bad.

**Reasonable signs a guide is over-budget:**

- The same idea appears in more than one section.
- A "Things that trip people up" list mostly recaps content from the body.
- The UI walkthrough names buttons the user can read off the screen.
- A subsection explains an internal mechanism (e.g. "the event reads from the place") when the reader only needs the consequence ("edits propagate").

**Reasonable signs a guide is under-developed:**

- Affordances are documented but no-go regions aren't.
- The reader has to infer which feature solves their problem.
- Naming, taxonomy, and other "design the right list" decisions get no advice.
- Federation and multi-calendar interactions aren't named at all.

A stub that telegraphs the planned scope of a guide-to-be-written is better than a thin half-guide that pretends to be complete. Use the placeholder pattern (`> Status: stub. Full guide coming before launch.`) and bullet the planned scope so a reader can see what's missing.

## Pre-publish checklist

Before claiming a guide is ready, run through these:

- [ ] Does the first paragraph say what the guide covers, and does the section index name the reader?
- [ ] Would a calendar owner use every word in conversation?
- [ ] Does each paragraph end on a fact, not a slogan?
- [ ] Is each concept called by one term, matching the label on the screen?
- [ ] Has every label, position and default been checked against the app?
- [ ] Does each major section answer a specific question the reader would actually ask?
- [ ] Is every UI walk-through earning its detail, or is the reader going to figure that out from the screen?
- [ ] Are decision points called out explicitly, with a quick test?
- [ ] Is there at least one piece of organizer-judgment advice, anchored to a specific decision?
- [ ] Are the no-go regions named, not just the affordances?
- [ ] Did you cross-link rather than restate content from another guide?
- [ ] Could a co-editor six months from now use this guide to settle an argument?
