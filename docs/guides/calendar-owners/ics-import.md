---
description: Migrate events into Pavillion from Google Calendar, Nextcloud, WordPress, Gancio, Mobilizon, and other tools via standard ICS import.
---

# Migrate from another calendar via ICS import

Many new calendar owners arrive with events already living somewhere — a Google Calendar, a Nextcloud instance, a WordPress events plugin, a Gancio or Mobilizon calendar. This guide is about moving that history onto Pavillion using ICS, the standard calendar-data format that almost every calendar tool can export.

The steps of ICS import are deliberately simple: you point Pavillion at an ICS feed published by your source, prove you control the source, and pull events on demand. That's enough for the migration case it's designed for: getting the events you already have onto your new calendar, with the edits you make on Pavillion sticking.

## What ICS import is for

A bit of background on what this import process is for, before you set anything up.

**Fits:** moving the events from a calendar you already run somewhere else onto your new Pavillion calendar. A community center switching from a self-hosted Nextcloud calendar. A venue migrating off a WordPress plugin. An arts group consolidating a Gancio install. In all of these you have access to the source, and the goal is one-time migration plus the option to keep nudging Pavillion to pick up edits while you wind the old system down.

**Doesn't fit:** aggregating events *from a third party you don't control* — a neighboring calendar, a regional partner, a Facebook page. ICS import requires you to prove ownership of the source domain, which only works if the source is yours. For pulling events from other people's calendars, see [follow-and-repost](./follow-and-repost).

**Also doesn't fit:** direct connections to hosted providers like Google Calendar, Outlook/M365, or iCloud. ICS import only covers feeds you can publish at a stable public URL on a domain you control. If your source is one of those hosted providers, the workable path is to export an ICS file and host it somewhere on your own domain.

## What gets imported, and what doesn't

It's worth knowing what data imports smoothly and what will take a bit of work on your part.

**Pavillion brings in:**

- The event's **title** and **description**. HTML in the description is stripped down to plain text — the old system's bold and italics won't survive, but the words will.
- **Start and end times**, including the source's timezone.
- **Recurrence rules** — weekly, monthly, daily, with an interval, a count, an end date, or specific weekdays. Exceptions come through too, so an event whose source said "every Tuesday except December 24" stays that way on Pavillion.
- The event's **external link**, if one was set.

**Pavillion does not bring in:**

- **Locations as places.** ICS doesn't carry a structured address — just a free-text `LOCATION` field — so Pavillion appends that text to the event's description and leaves the **Place** field empty. After import, you can attach proper places to events from your **Places** list. The places guide covers that; the "Things that trip people up" section below covers why this matters for migration.
- **Categories or tags.** The ICS file may have categories on each event, but Pavillion's category system depends on your calendar's category list, and reading a category name off a feed isn't the same as picking which bucket of yours it belongs to. After import, tag events from your own category list — see [the categories guide](./categories).
- **Attendees, organizers, attachments.** ICS files in the wild often carry personal data (email addresses on `ORGANIZER` and `ATTENDEE`, files on `ATTACH`) that has no business being on a public events page. Pavillion drops these fields on import by design.

Because of these technical decisions, an event that imports correctly will still be missing its place and its categories. Plan to take a pass through the events after the first sync to categorize them and re-attach places.

## Add an import source

Open your calendar's management page and find the **Import** tab.

If you haven't added an import source yet, the panel shows an empty state with one button. Click <Btn>Add Import Source</Btn> — a modal opens with a single field: **Calendar URL**. Paste the public address of the ICS feed you're importing from (the placeholder is `https://example.com/calendar.ics`, as an example).

A few notes on the URL itself:

- **It has to be a public URL** Pavillion's servers can reach. A `localhost` URL or a feed that requires a password won't work. If your source calendar's "Export" feature gives you a private subscription link with a token in it, that's fine as long as the link is reachable over the open internet — but be aware that anyone who learns the URL can read the feed.
- **Pick the feed URL, not the calendar page URL.** Most calendar tools have a separate "Subscribe (ICS)" or "iCal feed" link that points at the `.ics` file. That's what goes in this field.
- **`https://` is strongly preferred.** Pavillion can fetch over `http://` but doing so means anyone on the network path can read your feed and tamper with imports. If your source can serve over `https://`, use that URL.

Click <Btn>Add source</Btn>. The new source appears in the list, and the verify-ownership wizard opens automatically — you can't sync until you've proved the source is yours.

::: tip <Lightbulb /> A note on the calendar URL field.
The URL you paste here is the URL of the ICS *feed* — the dynamic file your source generates with all the events in it — not the URL of the source's web page. They're usually different. If you paste a page URL by accident, the first sync will fail with a parse error; just open the row and re-create the source with the right URL.
:::

## Verify ownership of the source

Pavillion won't fetch events from a feed until you've proved you control the domain that publishes it. The verification is what tells Pavillion that you, the calendar owner, are also the owner of `example.com`.

The wizard offers two methods. Pick whichever you can publish on the source domain.

**An HTML link on a page.** Pavillion shows you an HTML snippet (`<a rel="me" href="...">`) and a field to enter the URL of a page where you've published it. Paste the snippet into any page on the same domain as the feed — the homepage, an "about" page, a hidden test page — it doesn't matter as long as it's publicly fetchable and on the same hostname — then put that page's URL in the field and click <Btn>Verify</Btn>. This is the best option if you can edit pages on the site but don't have DNS access.

**A DNS TXT record.** Pavillion shows you a record name (`_pavillion-challenge.your-source-domain.example`) and a record value (`pavillion-verify=v1:your-instance:a-long-token`). Copy them into your DNS provider's control panel as a new TXT record on that name, save, wait a minute for DNS to propagate, then click <Btn>Verify</Btn>. This is an option if you have access to the DNS provider for the source domain.

Either method proves the same thing, just through a different file you control. There's no difference in what you can do afterward.

Verification doesn't last forever — the record needs to stay published so Pavillion can re-check it periodically. If the verification expires (the TXT record gets cleaned up, the page you put the snippet on is deleted), syncs keep working for a 14-day grace window so you have time to notice and republish. Past that window, the source goes back to unverified and syncing stops until you re-verify.

::: tip <Lightbulb /> A note on DNS that won't verify.
DNS changes are usually quick but not instant — most providers propagate in under a minute, some take longer. If a verify attempt says the record wasn't found and you just published it, wait a minute and try again before assuming something's wrong with the record itself. If repeated tries still fail, double-check the record name (it must be exactly `_pavillion-challenge.` followed by the source's hostname, no extras) and that you saved the record as a TXT record specifically — not a CNAME, not an A record.
:::

## Run a "Sync now" pull

Once a source is verified, its row in the **Import Sources** list shows a <Btn>Sync now</Btn> button. Click it to pull events from the feed.

A sync runs in one shot: Pavillion fetches the ICS file, parses each event in it, and either creates new events on your calendar, updates events that have changed at the source, or leaves them alone if nothing's changed. When it's done, a notification at the bottom of the screen tells you the result — for example, *Sync complete: 47 added, 0 updated.*

A few things worth knowing:

- **Speed is bounded by the feed.** Pavillion has to fetch the file before it can do anything. A small ICS (a few dozen events) is near-instant. A large one (a few thousand events) takes longer — the feed download is the slow part, and the source server determines how fast that goes.
- **Most syncs do nothing.** Pavillion saves the version it last fetched, and on subsequent syncs it asks the source "has this changed since then?" If the source answers no (or if the file looks identical to last time), Pavillion skips parsing entirely and the notification reads *Sync complete: no changes.* That's by design — syncing the same unchanged feed shouldn't change your event list.
- **There's a rate limit.** You can run **Sync now** up to four times per hour, per source. That's high enough for normal migration work — fixing something on the source, re-syncing, fixing the next thing — and low enough to keep your source server from getting overwhelmed.

## What happens on subsequent syncs

The second and third syncs are where most surprises come from, so the rules are worth knowing up front:

- **Renaming or editing an event on the source doesn't create a duplicate on Pavillion** — the existing event gets updated in place.
- **Once you've edited an event on Pavillion, your edit wins.** Later syncs leave that event alone; the source's version is not re-applied. This is the rule that makes migration predictable.
- **Events that disappear from the source are not deleted on Pavillion.** If you want them gone, cancel or delete them by hand on Pavillion.

Here's the mental model: **the source is in charge of an event until you touch it on Pavillion, after which Pavillion is in charge.** Leave an event alone and the source can keep refining it; touch it and your version sticks.

## Things that trip people up

The places imports most often go sideways during a migration:

**Timezone drift.** ICS includes timezones, but only some calendar tools do it correctly. If a source's events have a recognizable timezone (`America/New_York`, `Europe/Berlin`), Pavillion preserves it. If a source uses a non-standard timezone name or none at all, Pavillion falls back to the source calendar's timezone value if it has one — and if that's also missing or unrecognizable, the event ends up in UTC. The symptom is a recurring event whose times look five or eight hours off from where they should be. The fix is to look at the source's calendar-level timezone setting and republish the feed with a standard IANA zone name; if you can't change the source, you can edit each event's time on Pavillion after import (your edits stick — see above).

**Recurrence-rule fidelity.** Pavillion supports the common shapes of recurrence (every N days/weeks/months/years, with a count or end date, with specific weekdays, with exclusions for skipped dates). It does not yet interpret RFC 5545 "occurrence overrides" — the syntax some calendar tools use to say "this whole recurring series is itself, except on March 14 when it had a different title and time." On Pavillion those overrides come in as separate standalone events keyed by their occurrence date, which is *usually* what you want but doesn't preserve the parent-child relationship. If your source's calendar uses complex per-occurrence customizations, expect to clean those up by hand after import.

**Place deduplication.** ICS only carries `LOCATION` as a free-text string — "Riverbend Community Center, 123 Main St" — so Pavillion can't tell whether two events at the same venue are the same place. On import, Pavillion appends the location text to the event's description so the information isn't lost and leaves the structured **Place** field empty. To get the reuse benefits of [places](./places) (one venue → many events, fix the address once and everything updates), you'll need to create proper places on your calendar and attach them to the imported events. This is migration work; budget time for it.

**A description full of "Location:" prefixes.** Because of the place situation above, every imported event's description has a `Location: …` line at the end. After you've attached proper places, those leading lines are redundant and can be cleaned up by editing each event's description.

**HTML in descriptions.** If your source's description was rich text — bold, italics, links — only the plain text survives the import. Links that mattered (an "RSVP here" line) should be moved to the event's external-link field where they get a dedicated spot.

**Events that arrived without an end time.** Some sources publish events with only a start time. Pavillion imports them with no end set, which displays fine but won't appear on calendars that filter by end-time windows. Editing each event to give it an end time is the fix; you can do this from the event editor on Pavillion.

Keep in mind that the ICS import tool is built for migrations: use it to bring the events over, edit them on Pavillion to clean up the gaps (places, categories, end times, the bits ICS doesn't carry), and treat the old system as winding down. Once an event has been touched on Pavillion, your edits are sticky — the source can keep refining the events you haven't touched, and the events you've adopted as your own stay the way you set them.
