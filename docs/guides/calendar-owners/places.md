# Manage event locations

A *place* in Pavillion is an event location you save once and reuse — an address, a name, a few details. Create the venue once and you can link it to ten different events. Then, when the venue changes its name or you spot a typo in the address, you can fix it once and every event there is updated. (You'll manage them on the **Places** tab on your calendar page, alongside Events, Categories, and Series.)

A place can be flat — just an address — or it can have rooms and spaces inside it: named sub-locations like *Main Hall*, *Children's Story Corner*, *the gym*, *the back studio*. When a venue hosts events in specific sub-areas, an event can attach to either the whole venue or a specific room within it.

This guide covers what places are, how rooms and spaces fit, how to create both, how to attach them to events, and what changes when you edit one. It also covers the cases where a place is the wrong tool — online events, venues that aren't settled yet.

## How places work

A place lives on its own, not inside any one event. When you attach it to an event, the event doesn't take a copy of the address — it just remembers which place it's at and reads the details from there. The place's name, address, and accessibility notes appear in their own dedicated spots on the event's public page, rather than a sentence buried in the event description.

That structure pays off three ways:

- **Edit once, propagate everywhere.** When a venue renames itself, you fix the place — not every event that uses it. The lists, detail pages, and public calendar all show the new name on the next page load.
- **Reusable across events.** Recurring venues become one-click picks instead of address retyping. Over a year of running a calendar, a small set of places covers most of your events.
- **Free directions link.** If the place has a street address, the public event page renders it as a tap-to-open link — one-tap navigation on a phone, a map in a new tab on desktop. Just fill the address in and it happens automatically.

A place belongs to a calendar. If you run more than one calendar, each calendar has its own list of places — they aren't shared. That's usually what you want, since the venues a community garden uses are different from the venues a folk concert series uses.

**Rooms and spaces are part of the place.** A place with internal structure — a library with three meeting rooms, a community center with a hall and an art studio — can name those rooms inside the place itself. The place holds the address; each room carries its own name and any room-specific accessibility notes. When you attach a location to an event, the picker shows the venue itself *and* each named room as separate options. Picking *Riverbend Community Center* attaches the whole venue; picking *Riverbend Community Center — Art Studio* attaches the studio specifically. Rooms work the same way places do — change a room's name once and every event using that room updates.

## Create a place

You can create a place two ways: ahead of time from the calendar's **Places** tab, or on the fly from inside the event editor. Both routes do the same thing — pick whichever fits the moment.

**From the Places tab.** On your calendar page, switch to the **Places** tab (alongside Events, Categories, and Series). The first time you visit, the list is empty. Click <Btn>Add Place</Btn>. The place editor opens as a full page with three sections:

- **Basic information.** A name (required), street address, city, state or province, postal code. The name is the only required field — you could save a place with just a name if that's all you have, though for most venues the address fields are what makes the place useful.
- **Accessibility information.** A free-text field for things that apply to the *whole venue* — wheelchair access at the main entrance, ASL interpretation policy, scent-free notes, parking notes — anything a visitor specifically needs to know about getting into and around the building. If your calendar publishes in more than one language, this field shows a row of language tabs so you can write the accessibility note once per language.
- **Rooms & Spaces.** Optional. If the venue has named sub-locations, list them here. Click <Btn>Add room or space</Btn> to add one to the list; give it a name (required, translatable per language) and any room-specific accessibility notes (also translatable). Saving the place saves the rooms along with it.

Click <Btn>Save</Btn>. The place — and any rooms you added — are now in your list and available to attach to events.

**From inside the event editor.** While editing an event, click <Btn>Add Location</Btn> in the **Location** section. A picker opens showing every place this calendar already has. If the venue isn't in the list, click <Btn>Create New</Btn>, fill in the basic information, accessibility notes, and any rooms you need, and confirm. What happens next depends on whether you added rooms:

- **No rooms.** The new place is attached to the event right away, with the whole venue selected. You're done.
- **One or more rooms.** The picker re-opens with the search pre-filled with the new place's name and the whole-venue entry pre-selected. Click a room to refine the choice, or close the picker to keep the whole venue. Either way the place is saved to the calendar and reusable from future events.

The on-the-fly form is the express lane — it covers the venue and any rooms or spaces you need to add. The place is now reusable from any future event on this calendar.

::: tip <Lightbulb /> Just create the room you need right now.
Specific rooms help attendees find the right door — but you don't have to map out every space in a venue while you're in the middle of creating an event. Add the room this event happens in, save, and the picker re-opens with the new place ready to choose from — pick the room you just added, or stick with the whole venue. The next time you publish an event at the same venue, add another room then if you need one. The list fills in as you actually use it.
:::

## Attach a place — or a specific room — to an event

In the event editor, find the **Location** section and click <Btn>Add Location</Btn>. The location picker opens with your saved locations listed alphabetically.

What the list looks like depends on whether your places have rooms:

- **A place with no rooms** appears as a single entry. Picking it attaches the venue.
- **A place with one or more rooms** appears as multiple entries: one for the whole venue (suffixed *(whole venue)*) and one for each room (with a door icon, indented). Picking the whole-venue entry says "this event uses the building broadly"; picking a room entry says "this event happens in this specific room."

There's a search box at the top of the picker. It searches across each entry's name and address — so *Sterling* matches *Multnomah County Library — Sterling Room*, *Main* matches a venue called *Main Street Hall* and a venue at *200 Main Street*, both. Typing a room name finds it whether or not you can see its parent place at that moment.

Click an entry to select it. The picker closes and the chosen location appears in the event's Location section: the place's name (or *Place — Room Name* if you picked a specific room), with the address underneath. To swap it, click <Btn>Change</Btn> and pick again. To remove the location entirely (for an online-only event you originally tagged with a place), open the picker and use <Btn>Remove location</Btn>.

The event doesn't keep its own copy of the address. It remembers *which place — and which room, if you picked one* — and reads the details from there every time the event page loads.

## Edit a place after the fact

On your calendar page, switch to the **Places** tab, click the pencil icon on the place you want to edit, change what needs changing, save.

The change is reflected everywhere immediately. Every event currently attached to that place — past, present, future — will display the updated information on its detail page the next time the page loads. Past events aren't frozen; they show the venue's current state, not the state it was in on the day the event happened.

This is intentional, and it's the right behavior most of the time. If you correct a typo in the address, you want every event there to be correct. If the venue changes its name, you want every listing to reflect that. That's the whole point of places — if every event kept its own copy of the address, fixing a typo would mean editing ten events one at a time.

The same applies to rooms. Rename *Conference Room A* to *Sterling Room* in the place editor, save, and every event attached to that room shows the new name on next load. Edit a room's accessibility notes and they update everywhere too.

::: tip <Lightbulb /> A note on past events.
Because past events show the venue's current state, the archive of your calendar is a record of *what happened*, not *what the listing said at the time*. If you want a permanent snapshot of the original address — say, for an event ticket stub or a community history project — copy that detail somewhere outside Pavillion (the event description, an external doc) before the venue changes. This is rarely worth doing, but worth knowing.
:::

**Deleting a room.** When you remove a room from a place, the editor checks how many events are using it. If none, the room just goes. If some events use it, you get a small dialog asking where those events should go: onto the whole venue (the default and usually right answer), or onto a different room of your choosing. The events don't disappear and they don't lose their place — they just stop being attached to the room you removed.

**Deleting a whole place.** The delete dialog tells you how many events currently use the place; if you proceed, the place is removed from your list and every affected event keeps existing but loses its location entirely. The events don't disappear — they just no longer have a venue attached. You can attach a different place (or a new one) to any of them by editing the event.

## When to use a room or space

A place earns its keep through reuse, and a room earns its keep through *distinguishing*. The rule of thumb: add a room only when the same venue hosts events in sub-areas that visitors care about telling apart.

**Yes:** a public library where events happen in three different rooms, each with its own size, layout, and accessibility profile. A community center with a main hall, a gym, and an art studio that get used in parallel. A school where different events happen in the auditorium, the cafeteria, and specific classrooms.

**No:** a venue with a single usable space, even if you reuse it constantly. A coffeeshop with a tiny back room you've used once. A venue where the room is mentioned in the event description anyway and visitors don't navigate by it. In these cases the whole-venue place does the same job with less ceremony.

If you're not sure, leave the rooms off. A simple place is always cleaner; you can add rooms later, when a real reason shows up.

## When not to use a place

Most venues belong in your places list, even ones you'll only use once — the public listing is easier to use that way. The exceptions are events without a physical location and venues you can't yet commit to.

**Online-only events.** If the event is a video call, a livestream, or otherwise has no physical location, leave the location field empty and put the join link in the **External link** field. There's no venue to reuse and no address to update.

**Venues you're still figuring out.** If the booking isn't confirmed, or the address might change before the event happens, hold off on creating a place. You can attach one (or create one on the fly from the event editor) once the venue is settled.

## Naming places and rooms so they're recognizable later

The place's name is the first thing you see in the picker, so the way you name a place determines whether picking the right one feels obvious or feels like guessing.

**Use the venue's actual name when there is one.** *Riverbend Community Center* is a name your editors will recognize next month and next year. *Main location* or *That coffee shop* won't be — and a co-editor who joins six months from now won't have any idea what those refer to.

**Add a disambiguator when the name alone isn't enough.** If your community has two venues both called *The Hall*, name them *The Hall (Riverbend)* and *The Hall (Westside)*, or include the street so the picker shows them apart at a glance. The search will match either way, but the visible label is what makes the choice quick.

**Avoid names that age badly.** *New downtown space* stops being new. *Temporary venue* implies a successor that may or may not arrive. *Bob's place* breaks when Bob moves. Names tied to the venue itself age better than names tied to the moment.

**Don't put the address into the name.** The address has its own fields and is searchable. *123 Main Street Concert Hall* is harder to scan than *Main Street Concert Hall* with *123 Main Street* underneath it. Reserve the name for the human label; let the address be the address.

**Room names sit inside their parent.** A room is always shown next to its place — *Multnomah County Library — Sterling Room*, never *Sterling Room* by itself — so the room name doesn't need to identify the building. *Sterling Room* is enough; you don't need *Library Sterling Room*. Use whatever the venue itself calls the room: library staff already say *Sterling Room*, so that's the right name.

**Disambiguate within the parent, not across the calendar.** Two rooms in the same venue both called *Studio* become *Studio (front)* and *Studio (back)*, or *North Studio* and *South Studio*. Two rooms in *different* places can share a name without any trouble — the parent place name keeps them apart in the picker.

**Avoid generic room labels.** *Big room*, *Room 1*, *The other one* will be confusing the moment your list grows past two. If the venue has a real name for the room, use it; if it doesn't, pick a stable descriptor (*Front Hall*, *Upstairs Studio*) rather than a positional one.

A small habit pays off here. When you create a place or a room, ask yourself whether a co-editor — or you, six months from now, picking quickly from a list of fifteen — will recognize this name without having to read its address. If the answer is no, rename it before you save.
