---
description: Customize the public identity of your Pavillion calendar — name, description, languages, URL handle, and default event image.
---

# Customize your calendar's identity

Your calendar has a public face. Visitors see it when they land on your page; other calendar owners see it when they're deciding whether to follow you or repost from your events. This guide is about the settings you have to shape that presence deliberately — what to put in each field, and what gets harder to change later. These settings live in **Manage Calendar → Settings**.

## Who sees your identity, and where

Three views to keep in mind as you fill in the basics:

- **A visitor lands on your public page.** They may have found you from a link a friend sent them. They see your calendar's name in the header, your description below it, and your list of upcoming events. They form an impression in about five seconds.
- **Another calendar owner finds you to follow.** They've heard you're a good source for, say, Westside neighborhood events. They look up your handle, open a preview, and read your calendar description to decide whether to follow you. Your description is the thing standing between "this looks right" and "this looks generic — skip it."
- **A visitor whose preferred language isn't your calendar's primary one.** They see your name and description in their language if you've translated those fields, and in your primary language if you haven't.

Your identity settings serve all three views at once.

## The URL handle

Your calendar's URL handle is the short, lowercase, URL-safe name that identifies it across the network. It shows up in two places: the public address `your-instance.example/view/<handle>` that visitors paste into a chat, and the social handle `<handle>@your-instance.example` that other Pavillion calendars use to follow you.

You picked a handle when you created the calendar. **Right now, the handle is fixed when you create your calendar.** There's no rename button in the settings panel. If you've outgrown the handle — your "westside-2026" calendar is still going strong in 2027 — the practical move today is to create a new calendar with the new handle and migrate. That's expensive: every link, every bookmark, every reposting calendar's rule, every email signature pointing at the old handle becomes stale. So it's worth picking a handle that ages well *now*.

A short version of the advice — the longer version is in the [Quickstart](./quickstart):

- **Tie the name to the community, not to the moment.** `riverbend-folk` ages better than `riverbend-2026-season`. `westside-garden` ages better than `summer-projects`.
- **Recognizable out of context.** A neighbor pasting your handle into a chat shouldn't need a sentence of context for the recipient to know what it is. `mutual-aid` is too generic. `maplewood-mutual-aid` reads as itself.

::: tip <Lightbulb /> A note on the social handle.
The `@` shape (`riverbend-folk@your-instance.example`) confuses some people on first read — it looks like an email address but it isn't. It's the handle other calendars use to follow yours: someone on a different Pavillion instance types it into their "follow a calendar" field to pull your events into their feed.
:::

## Your calendar's name

The name is what appears in the page header, in search results, in follow previews when another calendar is deciding whether to subscribe to yours, and on every event that gets reposted from yours onto someone else's calendar (as the "source" attribution).

The Settings tab gives you one text field for the name, per language. Editing it saves when you click away from the field.

**Use the name your community actually calls itself.** *Westside Community Garden Events*, *Riverbend Folk Series*, *Maplewood Mutual Aid Calendar*. Names that match how people refer to the calendar in conversation work better than names invented for the platform.

**The name is your name, not a tagline.** The name should *identify*, not *pitch*.

**Names that age.** This is the same advice as the URL handle, but with fewer restrictions — you can change the name freely, so the cost of getting it wrong is small. Still, names tied to a year, an organizing committee, or a momentary branding choice will stop being accurate before the calendar stops existing.

## Your description

The description is one or two sentences. It appears under the calendar name on the public page and in the previews that other calendars see when someone looks yours up. After the calendar's name, it's the highest-leverage text you'll write for your calendar's identity, because every audience reads it and they're all making a decision when they do.

The Settings tab gives you a small free-text area, per language. The first language you write in is the primary description; visitors browsing in another language see that language's version if you've translated it, or fall back to the primary if you haven't.

**Tell a stranger who the calendar is for and what's on it.** "Events organized by and for the Westside community garden — workdays, harvests, potlucks, and quarterly meetings" tells a visitor whether they're in the right place. "All events" tells them nothing.

**Be specific about the community, not just the topic.** "Folk concerts" is a topic; many calendars list folk concerts. "Folk concerts at the Riverbend Community Center, presented by the Riverbend Folk Society" is a calendar. The difference matters when another calendar owner is deciding whether to repost from yours alongside their own folk listings — they're trying to figure out whether yours is relevant to their audience.

**Skip slogans and adjectives.** *Vibrant*, *welcoming*, *premier* and the rest of that vocabulary make the description sound like the back of a packaging insert. They also crowd out room for the specifics that actually tell a visitor what your calendar is.

::: tip <Lightbulb /> A note on writing the description for other calendar owners.
The people who run other calendars read your description with one question in mind: "if I follow this, what will land in my repost queue?" A description that names the kinds of events you publish, the geography, and the community is helping them answer that question.
:::

## Languages

Pavillion treats your calendar as multilingual from the start. The first language you write in is the primary, and you can add more from the language tabs at the top of the name and description fields.

**The languages you add determine what's translatable.** With one language, the editor shows simple text fields. Add a second, and tabs appear above the field — one tab per language. Each tab holds an independent version of the text. The same applies to event titles, descriptions, category names, place names, and accessibility notes throughout the calendar. Adding a language opens the option to translate everything; it doesn't translate anything by itself.

**Don't add a language you can't sustain.** A French tab that contains the English text — or worse, a single half-translated event from a year ago — is a worse signal than no French tab at all. It tells visitors that French content exists and is then immediately stale. If you're not sure you can maintain a language, don't add it; you can add it later.

For the rules of what's translatable, how visitors land on the right language version, and what happens when a visitor's preferred language isn't available, see [Publish in multiple languages](./multilingual). The Settings tab is where the calendar-level decision happens; the per-event mechanics live in that guide.

## The default event image

The default event image is an image that fills in for any event you publish without uploading one specifically for it. It shows up on your events list and on the event's own page when no event-specific image overrides it. It also travels with the event when another calendar reposts it — if the reposted event has no image of its own, your default lands on the other calendar's page as that event's image.

The Settings tab lets you upload one image. Uploading replaces it; removing it leaves events without their own image to show no image at all.

**Use a default that reads as your calendar, not as a specific event.** A neighborhood-association calendar's default might be the association's logo on a plain background, or a wide shot of the park where most events happen, or a piece of identifying community artwork. Avoid using a default that looks like it belongs to one particular event.

**The default is a fallback, not a requirement.** For any specific event that deserves its own image, upload one in the event editor and it'll override the default for that event. For routine events without strong visual identity — the monthly meeting, the weekly volunteer day — the default can stand in as a fallback visual.

## Things that trip people up

**Changing the calendar name doesn't change the URL handle.** Renaming the calendar from *Westside Garden* to *Maplewood Community Garden* in the name field changes the visible label everywhere, but the URL still says `/view/westside-garden` because the handle isn't tied to the name. Visitors with the old link still land in the right place — but the URL now disagrees with the name, and that mismatch confuses people. If a rename feels structural enough to want a new URL too, that's the case where creating a new calendar may make sense.

**Removing a language drops its translations.** If you added a French tab, wrote French versions of the name and description, then removed French from the calendar's language list, those French translations are gone. Pavillion will warn you before removing, but the warning is easy to click through. Take the warning seriously.

**The description renders as plain text.** Markdown, HTML tags, and line breaks beyond what the textarea preserves don't get formatted. If your description has a link in it, paste the URL as visible text — visitors can copy it, but it won't render as a clickable link in the description block. (Links inside *event* descriptions render normally; this is specific to the calendar-level description.)

**Default image edits update existing events that were using the default.** Every event without an image of its own reads from the calendar's current default the next time the page loads. Replacing the default this morning means yesterday's published events are now showing the new image too. This is usually what you want, but it's worth knowing before you swap.

## What's next

- The mechanics of multilingual content beyond name and description — [Publish in multiple languages](./multilingual).
- Sharing your calendar's public URL and social handle — [Share your public calendar URL](./public-url).
- Designing the rest of what visitors see when they land — [Organize events with categories](./categories), [Manage event locations](./places).
