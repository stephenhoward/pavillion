---
description: Post a recurring event on Pavillion — set the schedule, handle exceptions and skipped weeks, and decide when an event has outgrown recurrence for a series.
---

# Post a recurring event

Most calendars have at least one event that repeats — a weekly board meeting, a monthly meetup, a Tuesday-night open mic. This guide covers how to express those patterns in Pavillion, how to handle the inevitable exceptions ("we're skipping the week of Thanksgiving"), and how to tell when an event has outgrown recurrence and wants to be a series of distinct events instead.

## When recurrence is the right tool

Recurrence is for the same event happening on a predictable schedule, with mostly the same details each time: the board meeting on the third Wednesday at 7pm in the same room, the Tuesday-night open mic at the same coffee shop, the weekly community garden workday from 9 to noon.

If the events you're planning vary in ways that matter — different topics, different presenters, different titles — the right tool is probably a series, not recurrence. There's a short decision aid further down.

## Set up a schedule

Open the event editor — creating a new event or editing an existing one. Find the **Date & Time** section, where each event has at least one **Schedule 1** block with date, time, end date, end time, and timezone fields. Fill those in for the *first* occurrence of the event. Then click <Btn>Add recurrence</Btn> below the timezone field.

A panel slides in titled **Recurrence**.

**Repeats.** A dropdown that starts at *Never*. Pick *Daily*, *Weekly*, *Monthly*, or *Yearly*. As soon as you do, the rest of the controls appear.

**Every [N] weeks/months/days/years.** Most events are "every 1" of the chosen unit — that's just *weekly*, *monthly*, etc. The number is there for the cases that aren't: "every 2 weeks" for biweekly, "every 3 months" for quarterly.

**On.** For *Weekly* recurrence, a row of weekday pills — Sunday through Saturday. Click the days the event happens. (For a class that meets twice a week, click both days.) For *Monthly* recurrence, a grid of positional days — *1st Sunday*, *1st Monday*, all the way through *5th Saturday* — so you can pick "the 3rd Wednesday of the month" rather than a fixed calendar date. (If you want a fixed calendar date — "the 15th of every month" — leave this grid alone; the schedule's start date already sets the day.)

**Ends.** Three options:
- **never** — the event repeats indefinitely.
- **after [N] occurrences** — a finite count. Right for an eight-week course or a six-session series.
- **on [date]** — a specific end date. Right for a program that runs through the end of a season.

Click <Btn>Done</Btn> to close the panel. Back in the editor, the schedule now shows a plain-language summary: *Every Tuesday*, *Monthly*, *Yearly*. If something doesn't look right, the <Btn>Edit recurrence</Btn> button next to the summary reopens the panel.

Save the event. Pavillion fills in the repeating dates from the schedule — you don't enter each one.

::: tip <Lightbulb /> A note on the start date.
The schedule's **Date** field — the one outside the recurrence panel — is the *first* occurrence, not just a "starting from" reference. A weekly schedule with a start date of Tuesday January 7th will repeat on January 7th, 14th, 21st, and so on. If your start date is on a Tuesday but you've only checked Monday in the recurrence panel, the first occurrence won't be until the *following* Monday, January 13th — the Tuesday is skipped. Easier to keep the start date and the weekday selection consistent.
:::

## Add a one-off exception

Sometimes a recurring event has a one-off exception that doesn't fit the pattern — the weekly Tuesday meeting moves to Friday for one week because of a holiday, or a monthly board meeting adds an extra session before the annual meeting.

In Pavillion, an event can have more than one schedule. Below the first schedule block, click <Btn>+ Add another schedule</Btn>. A second schedule appears — *Schedule 2*, with its own date, time, timezone, and recurrence button. Set the date and time for the one-off occurrence and leave its recurrence at *Never*. That's a one-off date sitting alongside the recurring schedule.

If the exception *replaces* a regular occurrence (the Tuesday is moved to Friday, not added on top of it), you'll also want to cancel the original Tuesday occurrence — see the next section.

::: tip <Lightbulb /> A note on multiple schedules.
Multiple schedules are also the way to express "the same meeting at two different times each week" — a Monday morning and a Wednesday evening session, say. Add two schedules, each weekly, each with their own day and time. One event behind both rhythms.
:::

## Cancel a single occurrence

For a recurring event, the editor shows a <Btn>Manage cancellations</Btn> button below the schedule blocks. Click it to expand a **Cancellations** panel — a horizontal row of cards for the upcoming dates, each showing date and time. Later dates live further down the row; <Btn>Show more</Btn> appends the next batch, and <Btn>Jump to month</Btn> lets you skip ahead to a specific month.

To cancel one occurrence, find its card and click <Btn>Cancel</Btn>. The confirmation that opens has one decision worth thinking about — a **Hide from public** toggle:

- **Off (the default): show as cancelled.** The occurrence stays on the calendar. Visitors and any calendar reposting from yours still see it, but it's marked **Cancelled**. This is the right choice for an event that *was* announced and that people might be planning to attend — cancelling-but-showing tells them the meeting they had on their calendar isn't happening.
- **On: hide from public.** The occurrence is removed from the public page and from any calendar reposting from yours. This is the right choice for occurrences that haven't been visible long enough for anyone to be planning around them — for example, a brand-new recurring event where you want to skip an upcoming holiday week before the public page has had time to surface those occurrences.

Confirm with <Btn>Cancel instance</Btn>. The card now shows a **Cancelled** or **Hidden** badge, and its button changes to <Btn>Restore</Btn>. If you change your mind, click <Btn>Restore</Btn> to bring the occurrence back; that's immediate, no confirmation needed.

::: tip <Lightbulb /> A note on cancelling for the wrong reason.
Cancellation is for an occurrence that won't happen. If the event will happen but at a different time or place, you don't want a bare cancellation — you want a one-off exception (see above) *plus* a cancellation of the original occurrence. The pair tells visitors "the regular Tuesday is off, but we're meeting Friday instead." A bare cancellation just says "no meeting."
:::

## End the recurrence

When a recurring program runs its course — the eight-week class wraps, the seasonal series ends — wind it down by setting an end on the schedule rather than deleting the event. Click <Btn>Edit recurrence</Btn> on the schedule. In the **ends** section, switch from *never* to either *after [N] occurrences* or *on [date]*. Click <Btn>Done</Btn> and save the event.

Past occurrences stay on the calendar as history. No new dates appear after the end. People who attended in the past — and any calendar that reposted from yours — see the same record they always did; nothing rewrites the past.

::: tip <Lightbulb /> A note on shortening the end of a recurrence.
If you set the end date earlier than what's already been published, occurrences past that new end date disappear from the public page and from reposting calendars. People who had those occurrences on their personal calendar may end up confused. If the recurrence is being shortened because plans changed, consider cancelling the affected occurrences with a "show as cancelled" instead — visitors get to see *that* the dates were dropped rather than have them quietly vanish.
:::

## When recurrence isn't the right tool

A short decision aid: if the events you're planning share an *identity* — the same name, the same place, the same time, the same audience — and differ mostly in *date*, recurrence fits. If they share a *program* but differ in their substance — different speakers, different topics, different titles — a series is the better tool. A "Fall Lecture Series" with a different speaker each Thursday isn't one recurring event; it's seven distinct events grouped under a series name.

The quick test: would the title field be the same on every occurrence? If yes, recurrence. If you'd want to change the title — even slightly — for each occurrence, the recurrence editor will fight you, and a series is what you actually want.

## Things that trip people up

A short list of the most common stumbles.

**Changing the start time of an already-published recurring event.** If your Tuesday meeting was 7pm and you change the schedule's time to 8pm, *every* future occurrence shifts to 8pm — including ones that were already on the public page (and on visitors' personal calendars, if they added it). For a one-time time change, use a one-off exception schedule and cancel the original. For a permanent time change, accept that anyone who saved the old time has a stale entry, and announce the change visibly somewhere visitors will see it.

**Picking a weekday that doesn't include the start date.** A weekly schedule that starts on a Tuesday but only checks Monday in the recurrence panel will skip the first Tuesday entirely — the first occurrence won't be until the following Monday. Either set the start date to a Monday, or add Tuesday to the weekday selection if you want the first Tuesday to count.

**"Show as cancelled" on an event nobody was attending yet.** If you skip an occurrence on a brand-new recurring event before anyone's seen the public page, the **Cancelled** badge is just noise. Use **Hide from public** instead so the occurrence quietly drops out.

**Setting an end date earlier than the start date.** If the schedule's end date is before its start date, the event won't show any dates on the calendar. The editor allows this combination — it just means an empty schedule. Double-check both fields if a recurring event isn't appearing.
