# Documentation Voice and Structure Principles

> Version: 1.0.0
> Last Updated: 2026-05-10

This file covers voice, structure, and scope standards for Pavillion user-facing documentation in `docs/guides/`. These standards extend the marketing-site voice (pavillion.social) into reference material — same reader, same values, more depth.

## Who the guides are for

The marketing site names the audience directly: "a nonprofit, a local business, a church, a neighborhood group." Inside the guides, the framing matches — these are people doing real organizing work in their actual communities, not generic users moving through a wizard.

From `docs/guides/calendar-owners/index.md`:

> These guides are for the people running calendars on Pavillion — community organizers, venue staff, neighborhood associations, regional councils, anyone whose job it is to publish events that other people can find.

**Apply this:** Specificity matters. "Users" is a category that doesn't exist in the world. "The neighborhood association down the street" does. Name the reader before the second paragraph of any guide.

## What the guides are trying to do

Two things at once, in this order:

**1. Teach the software well enough that someone can do the thing.** Without this, none of the rest matters. A calendar owner who can't find the cancel button isn't going to benefit from advice about cancellation etiquette.

**2. Help the reader become a better calendar owner, organizer, or administrator.** The dual-purpose layer. Naming conventions that age, decision aids about which tool fits what, "when not to" framings, troubleshooting wisdom, the social rules of a federated network. This is what distinguishes a Pavillion guide from a feature manual.

The second goal lives *inside* the first, anchored to specific moments of action. **Don't write a sermon called "How to be a good calendar owner" and link to it from each topic.** The advice shows up at the point the reader is actually making the decision — when they're naming a category, choosing between recurrence and a series, deciding whether to repost an event from a neighbor.

## Voice principles

### Address the reader directly

Second person, present tense. "Your calendar," "your community." Match the marketing site's "you put real work into your events" register.

> A calendar that nobody finds is a calendar that doesn't exist.

> Most calendars worth running aren't run by one person.

### Lead with the conclusion, then explain

The reader is usually scanning to solve a specific problem. The conclusion goes first; the explanation supports it.

> Almost always the right call is to cancel — that leaves an audit trail, tells anyone who was planning to attend that the event isn't happening, and propagates correctly to any calendar that's reposting from yours. Deletion is for a smaller, more specific set of cases.

### Be concrete

Specific examples beat abstract principles. "Riverbend-folk ages better than riverbend-2026-season" lands. "Choose timeless names" doesn't.

> *Riverbend Community Center* is a name your editors will recognize next month and next year. *Main location* or *That coffee shop* won't be — and a co-editor who joins six months from now won't have any idea what those refer to.

### Be honest about limits

Pavillion does some things, doesn't do others, has rough edges. Pretending otherwise undermines trust and wastes the reader's time.

> Past events show the venue's current state, not the state it was in on the day the event happened.

> If you want a permanent snapshot of the original address ... copy that detail somewhere outside Pavillion (the event description, an external doc) before the venue changes. This is rarely worth doing, but worth knowing.

### Name things in the reader's vocabulary

Federation isn't ActivityPub. It's *follow*, *share*, *repost*. The protocol is internal vocabulary; the reader doesn't need it to use the feature.

> The mechanism underneath is ActivityPub federation, but you don't have to think in those terms. Most of the time the right words are *follow*, *share*, *connect*, and *repost*.

> Pavillion uses ActivityPub the way email uses SMTP — you don't need to know the protocol to send a message.

The same rule applies to internal Pavillion vocabulary that doesn't match what the reader thinks about. The codebase says "funding plan" instead of "subscription" because the latter means a different thing in a federated system; the guides should make that boundary visible without requiring the reader to learn the why.

### Don't preach

The reader is an adult organizing real events. Hectoring them about ethics or best practices reads as condescension. State the practical reason, let them decide.

> Pick something short, durable, and tied to the community rather than to a moment in time.

Not: "It's important to choose names responsibly." The first sentence is advice; the second is a lecture.

### Use warmth without slickness

Conversational and confident, not breezy or branded. The marketing site's "ready to give your community a calendar it deserves?" works there because it's the close. Inside the guides, warmth shows up as treating the reader like a colleague: "you'll know your community's actual buckets better than any generic list."

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

The decision aid for series-vs-recurrence used to appear three times across two files. Once is enough; cross-link the rest. If you find yourself restating something already covered, link instead.

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
- **Practical outcomes.** Marketing: "more people see your events, with less standing in the way." Guides: "a calendar that nobody finds is a calendar that doesn't exist."

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

- [ ] Does the first paragraph name the reader and the topic?
- [ ] Does each major section answer a specific question the reader would actually ask?
- [ ] Is every UI walk-through earning its detail, or is the reader going to figure that out from the screen?
- [ ] Are decision points called out explicitly, with a quick test?
- [ ] Is there at least one piece of organizer-judgment advice, anchored to a specific decision?
- [ ] Are the no-go regions named, not just the affordances?
- [ ] Did you cross-link rather than restate content from another guide?
- [ ] Could a co-editor six months from now use this guide to settle an argument?
