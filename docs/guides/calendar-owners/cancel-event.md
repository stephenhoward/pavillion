---
description: Cancel vs. delete an event in Pavillion — what changes for visitors, when to use which, and how cancellations propagate to calendars reposting yours.
---

# Cancel an event the right way

When an event won't happen as planned, you have two ways to handle it: cancel it, or delete it. Nearly always the right call is to cancel — that tells anyone who was planning to attend that the event isn't happening, and that information propagates correctly to any calendar that's reposting from yours. Deletion is useful for a smaller, more specific set of cases.

## Why cancellation is usually the right call

Three things happen when you cancel rather than delete.

**Visitors and attendees still see the listing.** The event stays on your public calendar, marked **Cancelled**, on the same date and at the same time. Anyone who was planning to attend — whether they had it on their personal calendar, told a friend about it, or just remembered seeing it — will clearly see the change in status. They can avoid showing up at the venue wondering where everyone is.

**The change propagates.** If other calendars are reposting events from yours, the cancellation flows out to them. Their visitors see the same **Cancelled** badge on the same listing. You don't have to message every calendar that picked up the event and ask them to update their listing — Pavillion does that automatically.

**The history is preserved.** Past events that were cancelled are part of your calendar's record. Six months from now, if someone asks "what happened with the May 3rd workshop?", the answer is right there on the calendar, instead of being a hole in the archive that nobody can explain.

Deletion does none of these things. A deleted event is gone — from your calendar, from any calendar reposting yours, from the archive. Visitors who were planning around it have no way to find out what happened; they just don't see it anymore. That's the right move for an event that *shouldn't* have existed in the first place, and the wrong move for an event that genuinely won't happen.

## How to cancel an event

The cancellation tool is currently available for recurring events. When you edit a recurring event — a weekly meeting, a monthly meetup, a Tuesday-night open mic — the editor shows a <Btn>Manage cancellations</Btn> button below the schedule. Click it and a panel opens with a card for each upcoming occurrence. Each card has a <Btn>Cancel</Btn> button that marks just that one date as cancelled.

The confirmation that opens has one decision worth thinking about — a **Hide from public** toggle:

- **Off (the default): show as cancelled.** The occurrence stays on the calendar. Visitors and any calendar reposting from yours still see the listing, but it's marked **Cancelled**. Use this when the event *was* announced and people might be planning to attend — cancelling-but-showing tells them the meeting they had on their calendar isn't happening.
- **On: hide from public.** The occurrence is removed from the public page and from any calendar reposting from yours. Use this when the occurrence hasn't been visible long enough for anyone to be planning around it — for example, a brand-new recurring event where you want to skip a holiday week before the public page has had time to surface those occurrences.

After you confirm, the card shows a **Cancelled** or **Hidden** badge, and its button changes to <Btn>Restore</Btn>. Restoring is immediate and needs no confirmation — useful if you changed your mind, or if a cancellation was made in error.

::: tip <Lightbulb /> A note on single, non-recurring events.
Pavillion's cancellation tool is built around occurrences of recurring events. A single event that isn't part of a recurrence doesn't get a cancel button in the editor — you have two options instead. If the event was announced and people may be planning to attend, edit the title to mark it cancelled (a prefix like *Cancelled —* on the front of the title is the convention) and update the description to explain. The listing stays where visitors expect to find it, and any calendar reposting from yours picks up the edit. If the event was never made public or only briefly visible, deletion is the cleaner move — see below.
:::

## When deletion is the right tool

Deletion is for events that shouldn't exist on the calendar at all, not for events that won't happen.

**Created in error.** An event you posted and immediately realized you didn't want, before anyone had a chance to see it. There's no attendee to inform, no reposting calendar to keep in sync, no history worth preserving. Deletion is appropriately quiet.

**Test events on a fresh calendar.** While you're learning Pavillion, you'll publish a few experiments — a placeholder title, a dummy date, a venue you made up. Delete those once you're done; they're not part of the calendar you actually want.

To delete events, open the calendar's **Events** tab, select the events you want to remove with the checkbox on each row, and click <Btn>Delete</Btn> in the bulk-action bar. A confirmation dialog asks once; confirming deletes the selected events.

::: tip <Lightbulb /> A note on what deletion can't undo.
A deleted event is gone from your calendar and from any calendar that was reposting it — but if you're deleting it because someone else has already seen it on a *different* platform (a Facebook share, a screenshot, a flier), the deletion in Pavillion doesn't reach those copies. For an event that's been out in the world, cancellation is almost always a better tool than deletion: the listing stays at the URL people may have bookmarked, and "Cancelled" is a clearer answer than a missing page.
:::

## End a recurring event entirely

When a recurring program runs its course — the eight-week class wraps up, the seasonal series ends, the Tuesday meeting becomes a Wednesday meeting permanently — wind it down by ending the recurrence rather than deleting the event.

Open the event editor, click <Btn>Edit recurrence</Btn> on the schedule, and in the **ends** section switch from *never* to either *after [N] occurrences* (a finite count) or *on [date]* (a specific end date). Click <Btn>Done</Btn> and save the event.

Past occurrences stay on the calendar as history. No new dates appear after the end. The recurring event itself remains in your editor in case you ever want to revive the program, but the public-facing schedule simply stops.

Deleting the recurring event instead would wipe every occurrence, past and future, from your calendar and from any calendar that was reposting it. For a program that actually happened, that's the wrong outcome. The history is what tells your community "this used to run here, on these dates" — useful information, even after the program has ended.

::: tip <Lightbulb /> A note on shortening a recurrence after the fact.
If you end the recurrence at a date *earlier* than what's already been published, the occurrences past that new end date disappear from the public page and from any calendar reposting from yours. People who had those occurrences on their personal calendar may end up confused — the event quietly vanished rather than being marked cancelled. If the program is being cut short because plans changed, cancel the affected occurrences with **show as cancelled** instead of shortening the recurrence. Visitors get a visible "this date was dropped" rather than a hole where the date used to be.
:::

## Things that trip people up

A short list of some non-obvious stumbles.

**Cancelling silently when it'll cost trust.** Hiding an occurrence from public has its place (see above), but it's the wrong tool for an event a real audience was planning around. Visitors arriving to find the event has *quietly vanished* read that as the calendar being unreliable. **Show as cancelled** is the honest move for an event with real attendees, even though the badge looks louder.

**Cancelling a series by cancelling every occurrence one at a time.** If a program is ending, end the recurrence — one save, clean history. Cancelling each future occurrence individually accomplishes roughly the same thing but litters the calendar with **Cancelled** badges for dates that were never going to happen anyway.

**Forgetting to cancel the original when adding a one-off replacement.** If you add a Friday schedule because Tuesday is moved, but you don't cancel the Tuesday occurrence, the public page now shows *both* — a Tuesday event that won't happen and a Friday event that will. The pair is the point: add the new occurrence *and* cancel the old.
