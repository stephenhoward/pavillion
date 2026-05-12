---
description: Group related events into a Pavillion series — a named program of distinct events that share an identity, like a concert season or a lecture run.
---

# Group related events into a series

A series is a named program made up of distinct events that share an identity — a *Summer Music Series* of concerts on different dates with different performers, a *Fall Lecture Series* with a different speaker each Thursday, a *Neighborhood Repair Café* that meets monthly with a different focus or location each time. The events differ in their substance, but they belong together under one program name. A series is how you tell visitors *these are part of the same thing*, even when no two of them are alike.

Series and recurring events both answer the question *"this thing happens more than once"* — but they answer it differently, and choosing the right tool up front saves a lot of editing later.

## When a series is the right tool

A series fits when you have a *program* with several distinct events under it: same identity, different content each time. The umbrella has a name; the events under it don't all share one.

A few shapes that are series:

- **Same program, rotating content.** A summer concert series with a different artist each week. A lecture series with a different speaker each session. A film series where the film changes each screening.
- **Same theme, varied formats.** A *Climate Resilience Week* with a panel discussion, a workshop, a bike tour, and a film screening — all under one banner, none of them the same kind of event.
- **Same program, rotating venue.** A *Neighborhood Walks* series where each walk explores a different part of town. A pop-up dinner series hosted at a different restaurant each month. A house-concert series moving from one host's living room to the next.

The thread is *identity over content*. A visitor looking at any one event in the series should be able to land on the series page and see the rest of the program, the way you might browse the back catalog of a podcast or the season archive of a TV show.

## When recurrence is the right tool instead

Recurrence fits when it's the *same event*, repeating on a schedule, with mostly the same details every time. The Tuesday-night open mic at the same coffee shop. The third-Wednesday board meeting at 7pm. The weekly community garden workday from 9 to noon.

The quick test: would the title field be the same on every occurrence? If yes, recurrence is the tool. If you'd want to change the title — even slightly — for each occurrence ("Concert: Maya García," "Concert: The Riverbenders"), that's a series of distinct events, not one recurring event.

A second test: would a visitor want to see *which* event is happening on a given date, or just *that* the event is happening? Recurrence says "the open mic is on Tuesday." A series says "this Tuesday's concert is Maya García; next Tuesday's is The Riverbenders." If knowing the difference matters to the visitor, you want a series.

::: tip <Lightbulb /> A note on the boundary case.
A few programs sit between the two — a weekly meditation group where the leader rotates, say, or a monthly potluck with a different host. If the events share a strong identity ("Sunday Sit") and the rotating detail is genuinely a detail (not the headline), recurrence with the changing piece in the description is fine. If the rotating detail *is* the headline ("This week: Maya García on improvisation"), it wants to be a series.
:::

## Create a series

Open <Btn>Manage Calendar</Btn> from your calendar page and find the **Series** tab. The first time you visit, the list is empty.

Click <Btn>Add Series</Btn>. A full-page editor opens with the following fields:

**URL name.** The slug that becomes the last segment of the series' public URL — `your-calendar/series/summer-music-series`. Lowercase letters, numbers, and underscores only. Pick something stable; the URL name is set when the series is created and stays put after that.

**Series name.** The display name visitors see — *Summer Music Series*, *Fall Lecture Series*. If your calendar publishes in more than one language, the editor lets you provide the name in each: click <Btn>Add Language</Btn>, pick the language, and fill in the translation. The series itself is one thing with multiple labels, the same way a category is.

**Description.** A short paragraph telling visitors what the series is about — the program's theme, who it's for, when it runs. This shows up at the top of the series' public page above the list of events. Optional, but a good description is the difference between visitors thinking *what is this?* and visitors thinking *I want to come to this*.

**Series image.** An optional banner image for the series' public page. The same kind of image you'd put on an event — a photo from a past session, the program's logo, anything that signals the series at a glance. If you skip it, the series page renders without one and that's fine.

Click <Btn>Create Series</Btn> to save. The new series appears in the list with an event count of zero.

To rename, retranslate, or change the image later, click the pencil icon on the series' row. To delete it, click the trash icon — the dialog will confirm. Deleting a series doesn't delete its events; the events stay on the calendar, they just lose their series assignment.

::: tip <Lightbulb /> A note on URL names.
The URL name is the only field that can't be changed after creation, because changing it would break any links to the series page that visitors or other calendars have already saved. The display name and description are freely editable; the URL slug is permanent. Pick one general enough to age well — *summer-music-series* travels into next year better than *summer-music-2026*.
:::

## Add events to a series

A series is empty until you put events in it. In the event editor — whether you're creating a new event or editing an existing one — find the **Series** section. There's a single dropdown labeled *Series*; the default is *No series*. Pick the series this event belongs to and save. To remove an event from a series, set the dropdown back to *No series*.

An event can belong to *one* series at a time, not several. If a single event genuinely fits more than one program — say, a panel discussion that's both part of a *Climate Resilience Week* and a *Speakers Series* — you'll have to pick one. Categories can do the cross-tagging; series are the primary affiliation.

::: tip <Lightbulb /> A note on populating a brand-new series.
Newly-created series don't have any events yet, and the series doesn't show up on your public calendar until at least one event is assigned. If your series page looks empty in the management list, that's expected — go assign events to it and refresh.
:::

## What a series looks like to visitors

When a series has events, visitors can find it in two places.

**The series' own public page** — `/view/your-calendar/series/your-series-url-name`. The page shows the banner image at the top (if you uploaded one), the series name, the description, and the full list of events in the series. Long series split into pages with next- and previous-page buttons at the bottom. Each event in the list links to that event's detail page. There's a back-link in the breadcrumb that returns the visitor to your main calendar.

**The footer of every event in the series.** On any event's detail page, the footer carries a small *Series:* label followed by a link to the series page. A visitor reading about *Concert: Maya García* on Tuesday can click that link and land on the *Summer Music Series* page with every concert in the program listed. That's the path most visitors will actually find a series through — the discovery flow is event → series → other events in the series, not the other way around.

There is no top-level series listing on your calendar's home page; series surface from individual events. Which means the description and image you put on the series matter — they're what a visitor sees the *first* time they arrive at the series page, often after clicking that footer link from an event they were already reading about.

## Things that trip people up

**A series with no events on it.** A series that hasn't been assigned to any events doesn't show up to visitors anywhere. If a series you created isn't appearing on the public side, check whether at least one event has been assigned to it.

**A typo in the URL.** The URL slug can't be edited after creation — changing it would break links visitors and other calendars have saved. If the slug is genuinely wrong, the only fix is to delete the series, recreate it with the correct slug, and reassign the events. (The display name and description are freely editable; only the slug is permanent.)
