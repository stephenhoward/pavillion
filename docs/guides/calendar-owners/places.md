# Reuse venues with places

A *place* in Pavillion is a venue stored as its own object — an address, a name, a few details — that events reference rather than copy. Type the venue's address once, attach it to ten events at that venue, and when the venue changes its name or you spot a typo in the address, you fix it once and every event there is updated.

This guide covers what places are, how to create them, how to attach them to events, and what changes when you edit one. It also covers the cases where a place is the wrong tool — online events, one-off venues — so you don't end up with a list of places you'll never reuse.

## How places work

Places are separate from events. An event has a *reference* to a place, not a copy of it. This is the single fact that explains everything else in this guide.

The day-to-day consequence is small but valuable. When the community center on Main Street renames itself, you don't go event by event correcting the venue name. You open the place once, fix the name, save. The event lists, the event detail pages, the public calendar — all of it shows the new name on the next page load.

The other consequence is that places are reusable. Every event you publish at the same venue picks the place from a list rather than retyping the address. Over a year of running a calendar, a small set of recurring venues accounts for most of your events; saving them as places turns each new event's location field from a typing exercise into a one-click pick.

A place belongs to a calendar. If you run more than one calendar, each calendar has its own list of places — they aren't shared. That's usually what you want, since the venues a community garden uses are different from the venues a folk concert series uses.

## Create a place

You can create a place two ways: ahead of time from the calendar's **Places** tab, or on the fly from inside the event editor. Both routes save the same kind of object — pick whichever fits the moment.

**From the Places tab.** Open <Btn>Manage Calendar</Btn> from your calendar page and find the **Places** tab. The first time you visit, the list is empty. Click <Btn>+ Add place</Btn>. The place editor opens as a full page with two sections:

- **Basic information.** A name (required), street address, city, state or province, postal code. The name is the only required field — you could save a place with just a name if that's all you have, though for most venues the address fields are what makes the place useful.
- **Accessibility information.** A free-text field for things like wheelchair access, ASL interpretation, scent-free policy, parking notes — anything a visitor specifically needs to know about getting into and around the venue. If your calendar publishes in more than one language, this field shows a row of language tabs so you can write the accessibility note once per language.

Click <Btn>Save</Btn>. The place is now in your list and available to attach to events.

**From inside the event editor.** While editing an event, click <Btn>Add location</Btn> in the **Location** section. A picker opens showing every place this calendar already has. If the venue isn't in the list, click <Btn>Create new place</Btn>, fill in the same fields, and confirm. The place is saved to the calendar (it persists past this event) and is attached to the event you're editing.

Either way, the place is now reusable from any future event on this calendar.

## Attach a place to an event

In the event editor, find the **Location** section and click <Btn>Add location</Btn>. The location picker opens with your saved places listed alphabetically.

There's a search box at the top of the picker. It searches across every field — name, address, city, state, postal code — so you can find a place by typing any of those, not just the name. *"Main"* will match a venue called *Main Street Hall* and a venue at *200 Main Street*, both.

Click a place to select it. The picker closes and the chosen venue appears in the event's Location section. To swap it for a different one, click <Btn>Change location</Btn> and pick again. To remove the location entirely (for an online-only event you originally tagged with a place), open the picker and use the <Btn>Remove</Btn> option.

Saving the event saves the reference to the place. The event doesn't store its own copy of the address — it remembers *which place* it points at, and reads the address from the place at display time.

## Edit a place after the fact

Open <Btn>Manage Calendar</Btn>, find the **Places** tab, click the pencil icon on the place you want to edit, change what needs changing, save.

The change is reflected everywhere immediately. Every event currently attached to that place — past, present, future — will display the updated information on its detail page the next time the page loads. Past events aren't frozen; they show the venue's current state, not the state it was in on the day the event happened.

This is intentional, and it's the right behavior most of the time. If you correct a typo in the address, you want every event there to be correct. If the venue changes its name, you want every listing to reflect that. The reference model is what makes this clean — a copy-and-paste model would have left ten events stuck on the old typo.

::: tip <Lightbulb /> A note on past events.
Because past events show the venue's current state, the archive of your calendar is a record of *what happened*, not *what the listing said at the time*. If you want a permanent snapshot of the original address — say, for an event ticket stub or a community history project — copy that detail somewhere outside Pavillion (the event description, an external doc) before the venue changes. This is rarely worth doing, but worth knowing.
:::

Deleting a place behaves a little differently from editing. The delete dialog tells you how many events currently use the place; if you proceed, the place is removed from your list and every affected event keeps existing but loses its location. The events don't disappear — they just no longer have a venue attached. You can attach a different place (or a new one) to any of them by editing the event.

## When not to use a place

A place earns its keep through reuse. Creating one for a venue you'll list once and never again adds friction without saving any.

**Online-only events.** If the event is a video call, a livestream, or otherwise has no physical location, leave the location field empty and put the join link in the **External link** field. There's no venue to reuse and no address to update.

**One-off venues you won't return to.** A pop-up at a borrowed location, a guest lecture in someone's living room, a single visiting artist's studio open day. If you're confident this is the only event you'll ever publish at that location, the cost of creating a place for it (a list entry to scroll past forever) outweighs the benefit (zero reuse). Put the address in the event description instead, or — if you want it more visible — in the accessibility field if it's part of the access notes.

**Venues you're still figuring out.** If the booking isn't confirmed, or the address might change before the event happens, hold off on creating a place. You can attach one (or create one inline from the event editor) once the venue is settled.

The bias should be toward fewer places, not more. A list of thirty places where you actually only use six creates exactly the friction the place system is supposed to remove — every new event you publish, you scroll past twenty-four near-irrelevant entries to find the one you want. Treat a place as a small commitment to reuse, and your list stays useful.

## Naming places so they're recognizable later

The place's name is the first thing you see in the picker, so the way you name a place determines whether picking the right one feels obvious or feels like guessing.

**Use the venue's actual name when there is one.** *Riverbend Community Center* is a name your editors will recognize next month and next year. *Main location* or *That coffee shop* won't be — and a co-editor who joins six months from now won't have any idea what those refer to.

**Add a disambiguator when the name alone isn't enough.** If your community has two venues both called *The Hall*, name them *The Hall (Riverbend)* and *The Hall (Westside)*, or include the street so the picker shows them apart at a glance. The search will match either way, but the visible label is what makes the choice quick.

**Avoid names that age badly.** *New downtown space* stops being new. *Temporary venue* implies a successor that may or may not arrive. *Bob's place* breaks when Bob moves. Names tied to the venue itself age better than names tied to the moment.

**Don't put the address into the name.** The address has its own fields and is searchable. *123 Main Street Concert Hall* is harder to scan than *Main Street Concert Hall* with *123 Main Street* underneath it. Reserve the name for the human label; let the address be the address.

A small habit pays off here. When you create a place, ask yourself whether a co-editor — or you, six months from now, picking quickly from a list of fifteen — will recognize this name without having to read its address. If the answer is no, rename it before you save.
