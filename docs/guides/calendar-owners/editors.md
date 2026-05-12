---
description: Invite editors to your Pavillion calendar, manage their access, and understand what editors can and can't do compared to the calendar owner.
---

# Invite editors and manage their access

Most calendars aren't run by one person. The volunteer who handles the music shows isn't the same person who handles the workshops, and neither of them wants to be the only one with the password. This guide is about adding people to the team — inviting editors, understanding what they can and can't do, removing someone when their role changes, and shaping access in ways that scale from a two-person project to a larger collective without losing track of who's allowed to do what.

A short orientation before the mechanics. Pavillion's editor model is deliberately simple: a calendar has one *owner* (the account that created it) and any number of *editors* (additional accounts the owner has invited in). There are no other tiers — no "contributor," no "moderator," no "publisher-but-not-deleter."

That simplicity is on purpose; the cost of a richer permission model is a constant low-grade tax of "wait, can they do this?" every time a new task comes up. The trade-off is that *editor* is a role you should hand out only to people you trust roughly as much as yourself.

## What an editor can do

An editor can do almost everything an owner can do *to the calendar's content*. Specifically:

- Create, edit, and delete events
- Manage the calendar's categories — create, rename, merge, delete
- Manage the calendar's places (the venue list events point at)
- Manage the calendar's series (the program-grouping mechanism — see the series guide)
- Run ICS imports from external sources
- Follow other calendars and repost their events (manually or via auto-repost rules)

What an editor *cannot* do — these stay with the owner:

- Change the calendar's settings: default date range, default event image, identity fields
- Change the calendar's URL handle or display name
- Invite or remove other editors
- Cancel or resend pending invitations
- Set up or change the calendar's funding plan
- Delete the calendar itself

That's the whole list. The split is roughly *content vs. identity*: editors shape what's *on* the calendar, the owner controls what the calendar *is* and who's authorized to shape it.

::: tip <Lightbulb /> A note on the report-review permission.
A separate per-editor toggle exists to let a specific editor review reports filed against the calendar's events (the moderation queue). It's not yet exposed in the editor management UI, so for now report review stays with the owner. The moderation guide will cover this in more detail once that surface lands.
:::

## Invite an editor

Open <Btn>Manage Calendar</Btn> from your calendar page and find the **Editors** tab. The first time you visit, the list is empty.

Click <Btn>Add Editor</Btn>, enter the email address of the person you want to add, and submit.

What happens next depends on whether that email already has a Pavillion account:

- **They already have an account on this instance.** They become an editor immediately. The email field accepts the address they signed up with. They get a notification email letting them know, and the calendar shows up in their list of calendars next time they log in.
- **They don't have an account yet.** Pavillion sends them an invitation email with a link to sign up. The link is good for seven days. When they accept and create their account, they become an editor on the calendar automatically — no second step required from you. While the invitation is outstanding, it shows up in your editors tab under **Pending Invitations**, where you can resend it (handy if it landed in their spam folder) or cancel it (if you sent it to the wrong address).
- **The email belongs to someone on a different Pavillion instance.** Use the federated form `casey@calendar.coffee` — their username and their instance's domain — instead of a plain email. Pavillion looks them up across the federation, adds them as a remote editor, and notifies their instance. Their editing actions on your calendar then flow through ActivityPub the same way any other federated activity does.

::: tip <Lightbulb /> A note on the invitation message.
The current invitation form doesn't offer a custom-message field, so the email arrives with Pavillion's default text. If context would help — *"this is the calendar for the food co-op, you said you'd help with the volunteer events"* — send them a separate message in whatever channel you normally use, before or after the invitation. The system email is functional but generic.
:::

## Revoke editor access

When someone steps back from the role — they've left the organization, taken a break, or you've simply realized the working pattern isn't right — open the **Editors** tab, find their card in the **Current Editors** list, and click <Btn>Remove</Btn>. The confirmation dialog asks once; once you confirm, their edit access ends immediately.

What happens to the events they created or edited: nothing. Events belong to the *calendar*, not to the editor who created them. The events stay published, the categories they tagged stay attached, the places they added to the venue list stay there. Removing an editor removes the person's ability to make further changes; it doesn't unwind their past contributions.

What happens to a pending invitation if you change your mind before the person accepts: open the **Pending Invitations** section of the same tab and click <Btn>Cancel</Btn> on the row. The invitation link stops working immediately, and the invited person — if they hadn't yet acted on the email — will see "this invitation is no longer valid" if they click it later.

If an editor wants to remove *themselves* from a calendar — they're stepping back, the project ended, the calendar is no longer something they want to be associated with — they can. Their view of the editors tab shows a <Btn>Leave Calendar</Btn> button at the bottom of the editors list. Clicking it walks them through the same removal flow without needing the owner's involvement. This is a small but important property: editor membership isn't something the owner can compel; people get to opt out.

## Patterns for small teams

The most common shape — one owner, one or two editors — barely needs a system. The owner created the calendar; the editors handle a slice of the events that the owner doesn't have time for. Everyone knows everyone, the working pattern is "whoever sees it first picks it up," and the editors tab gets touched maybe twice a year.

A few practical notes for this size:

- **Pick the owner carefully.** Some things only the owner can do (settings, editor management, funding). If the owner-account-holder is hard to reach or stops being involved, someone needs to be able to change those things. For a calendar that has more than one person actively running it, choose an owner who's reliably available and willing to do the maintenance tasks even though most of the day-to-day editing happens elsewhere.
- **Two-person teams should be two-account teams.** Even if it's just you and a co-organizer, give the co-organizer their own editor account rather than sharing the owner login. The friction is small, and you get independent passwords and the ability to remove access cleanly later. See *Shared accounts vs. individual accounts* below.
- **Talk about who's covering what.** Pavillion doesn't enforce a division of labor — every editor can edit every event. For a small team, "I'll handle the music shows, you handle the workshops" works fine as a verbal agreement. The system isn't going to stop someone from editing the other person's stuff, so the trust comes from the working relationship, not from the software.

## Patterns for larger collectives

When the team is big enough that the owner doesn't personally know every editor — say, eight or more people, or a mix of long-time members and rotating volunteers — the first thing to settle is whether this should still be one calendar at all. A larger collective tends to want subdivisions — "the music people," "the workshop people," "the kids' programming people" — that Pavillion's permission model doesn't reach. Every editor on a given calendar can edit every event on it; you can't scope an editor to "just the music section." Three ways to handle that, in roughly increasing structural commitment:

- **Lean on coordination, not permissions.** If your collective has a Slack, Discord, or matrix room, that's where "I'm taking the November workshop series" coordination should happen — not in the calendar's permission model. Pavillion gives every editor the same powers; your social layer decides who works on what. This is good when the subdivisions are soft and the team trusts each other.
- **Run separate calendars side by side.** If two parts of your collective publish to genuinely different audiences with little overlap, give them their own calendars. The music venue's calendar and the kids' programming calendar at the same community center can be two calendars under the same instance, each with only the editors who actually work on it.
- **Run an umbrella calendar that follows the others.** When the subdivisions are real but you also want a single front door — "everything happening at the community center this month" — set up an umbrella calendar that follows each of the sub-calendars and auto-reposts their events. The sub-calendars keep their own editor teams and their own audiences; the umbrella aggregates them into one view. A visitor who wants the firehose bookmarks the umbrella; a visitor who only cares about kids' programming bookmarks that calendar directly. (See [follow and repost](./follow-and-repost) for how auto-repost rules work, and [when to create a calendar](./when-to-create-a-calendar) for the broader decision.)

Pick before scaling the editor list. Onboarding eight editors into a calendar that should be three calendars is wasted work.

**Onboarding becomes a thing.** A new editor on a small team learns the ropes by sitting next to the existing owner; a new editor on a larger team needs to be told what they're doing. Plan a short orientation: walk them through the calendar, point them at the calendar-owner guides relevant to their work, agree on the categories and places they should and shouldn't add. Five minutes of orientation prevents weeks of "wait, why is there a *Concerts*, *Concert*, and *Live Music* category?"

**Offboarding becomes a thing too.** People rotate out. Set a rough cadence — once a quarter, once a year, whatever fits — to look at your editors tab and ask "is this list still right?" Editors who are no longer involved should come off the list, not because they've done anything wrong but because the list represents *who can change the calendar today*, and a stale list is a security and consistency risk. The removed person can always be re-invited later.

## Shared accounts vs. individual accounts

Almost every team eventually has the same conversation: *should we just make one shared "team" account that everyone logs into?* The answer is almost always no, and it's worth being explicit about why.

Sharing one account looks easier on day one. One password to circulate, one inbox for invitation emails, no per-person account creation. The hidden costs show up later:

- **No selective offboarding.** When someone rotates out, you have to change the shared password and notify everyone *else* of the new one. If you don't, the person who left still has access. If you do, you've turned a routine departure into a coordination problem affecting the whole team. Individual accounts make offboarding a single click — remove that editor, done.
- **Permission inflation.** The shared login is usually the *owner* account, since that's where the calendar came from. That means everyone using it has owner powers, including the ability to change settings, manage funding, and delete the calendar itself. Individual editor accounts let people work on content without holding the keys to the calendar.
- **Password hygiene falls apart.** Shared passwords get written down, pasted into chats, sent in emails, never rotated, sometimes reused for other things. Personal passwords — paired with whatever the individual's normal authentication discipline is — are dramatically more secure in practice.

The case where a shared account is *almost* defensible is "we have one volunteer who handles the calendar and we don't want to retrain a new person every six months when the role rotates." Even there, the right move is to add the new volunteer as their own editor before the old one rotates off, let them shadow for a week, then remove the previous editor. A week of overlap costs nothing; a forgotten shared password costs the next year of "wait, who has the login?"

The short version: every person who edits the calendar should have their own Pavillion account, and you should add and remove them as people rather than passing a shared identity around. The friction is small, the payoff compounds.

## What's next

- If you're inviting an editor for a specific job — moderating reports, running ICS imports, managing categories — the relevant per-task guide goes deeper on what they'll be doing day to day.
- If your team is bigger than this guide assumes, consider whether you actually want one calendar with many editors, or several calendars with the right editors on each one. The [When to create a calendar](./when-to-create-a-calendar) guide covers that decision.
- If you're stepping back from a calendar yourself, the **Leave Calendar** button covered above is the right tool. If *you're the owner* and need to hand the calendar off entirely — owner transfer is not yet supported in v1, so reach out to your instance administrator for help.
