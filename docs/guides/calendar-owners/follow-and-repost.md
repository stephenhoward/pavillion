# Bring in events from other calendars

The neighborhood association down the street already runs a calendar. So does the music venue across town and the regional climate-action group. This guide is about bringing some of *their* events onto *your* calendar — finding the calendars that matter to your community, deciding what to do with what shows up, and choosing what to share onward.

The mechanism underneath is ActivityPub federation. The interface uses "Follow" and "Repost" on the buttons, and this guide names those buttons literally when walking you through them — but also describes what they *do* in plainer terms: connecting to another calendar, and publishing an event from it onto yours.

## Two steps, on purpose

The action splits into two stages, and the separation matters.

**Connect.** You point your calendar at another one — say, the music venue's — and from then on, their events arrive in a stream visible only to you. Nothing about your *public* calendar has changed yet; your visitors still see exactly what they saw before. A connection is a private feed for you, the owner, to look through.

**Publish.** When an event in that private feed is worth surfacing on your public calendar, you publish it. *Now* visitors see it. Publishing can happen by hand — one event at a time, deliberately — or by rule, where you've told Pavillion to publish certain incoming events automatically.

The separation is what gives you editorial control. Connecting to a calendar doesn't commit you to publishing anything from it; it just opens the door so you can decide.

## Find calendars worth connecting to

There's no central directory of Pavillion calendars. Federation works the same way email does: to connect to someone's calendar, you need its address, and the way you get its address is the same way you'd get someone's email — ask, or look at their website.

A few starting places:

- **Calendars listed on the websites of organizations you already work with.** A neighborhood association, a music venue, an arts council, a coworking space, a climate or mutual-aid group. Their site footer or events page often points at their calendar.
- **The sources behind events you already like.** On a calendar you trust, reposted events link back to the calendar they came from — a small calendar-name link beneath the event title. If a particular source keeps showing up on calendars you respect, that's a good signal it's worth connecting to yourself.
- **Word of mouth.** Other calendar owners will tell you which calendars to track. The federated network tends to grow through introductions, not directory listings.

Calendar handles take the shape `calendar-name@domain.example`. The part before the `@` is the calendar's URL handle on its instance; the part after is the instance's domain. *`riverbend-folk@arts.example`* points at the `riverbend-folk` calendar on `arts.example`. (Calendars on your *own* instance can be referenced by just their URL handle — `riverbend-folk` is enough if you're both running on the same instance.)

## Connect to a calendar

Open <Btn>Feed</Btn> from the main navigation. The Feed has three tabs: **Events** (events from calendars you're connected to), **Following** (the calendars you've connected to), and **Followers** (calendars connected to yours). If you run more than one calendar, a calendar selector at the top scopes the feed — connections are *per-calendar*, not per-account; each of your calendars has its own list, its own feed, and its own followers.

In the **Following** tab, click <Btn>Follow a Calendar</Btn>. A dialog opens with one field: the calendar's identifier — `name@domain.example` for a remote calendar, or just `name` for one on your own instance.

Type the identifier. Pavillion looks the calendar up after a brief pause and shows you a preview — the calendar's name, description, and domain. The preview is everything you'd see on the calendar's public page; use it to confirm you've got the right one before connecting.

Below the preview are the auto-repost toggles. They control what happens automatically when events arrive from this calendar — see [Let rules publish for you](#let-rules-publish-for-you) below for what each one does. If you're not sure what to pick, leave both off; you can publish any individual event by hand later, and you can change these toggles for any connection at any time.

Click <Btn>Follow</Btn>. Pavillion sends a follow request to the source calendar; once their server has accepted it (which is usually immediate), their events start arriving in your feed.

To disconnect entirely, find the calendar's row in the **Following** tab and click <Btn>Unfollow</Btn>. That's a heavier action than unpublishing a single event — it ends the connection completely, no future events flow in, and any auto-repost rules on the connection go away with it.

::: tip <Lightbulb /> A note on the optional category-matching step.
Right after a successful connection, a second step in the dialog offers to match the source calendar's categories to your own — *their* `Live Music` to *your* `Concerts`, for example. Setting these up now means any event you publish from this calendar — by hand or by rule — lands in the right category on yours without re-tagging. You can skip the step and configure it later from the **Match categories** link on the connection's row in your Following tab; the category-matching guide covers the details.
:::

## What lands in your feed

Two things populate as a result of connecting to another calendar.

**Your feed.** The **Events** tab in the Feed section is the stream of incoming events from every calendar this one is connected to, newest first. A feed event isn't on your public calendar — it's just visible to you, the owner, as something you *could* publish. Each row has a <Btn>Repost</Btn> button for publishing it onto your calendar, plus a <Btn>Details</Btn> button for the full event view and a <Btn>Report</Btn> button for flagging genuinely problematic content — spam, harassment, misleading information, or content that violates your instance's policies. If an event just isn't a fit for your calendar, don't report it; not publishing it is the right response.

**Your inbox.** The <Btn>Inbox</Btn> in the main navigation is the activity log for *your* calendar — notifications when someone new connects to you, or when another calendar publishes one of your events on theirs. Connecting to a calendar doesn't directly change your inbox; the inbox is about what other calendars are doing with *yours*.

In short: **the feed is what's coming in. The inbox is what's happening to your work.** A visitor to your public page never sees what's in your feed — they see what you've already published. The feed is your editorial space; the calendar is your public face.

## Publish an event by hand

In the Feed > Events tab, find an event you want on your public calendar and click <Btn>Repost</Btn>. If the source event has categories that aren't yet matched to one of yours, a small dialog opens letting you pick the right local categories — or pull the source's category names onto your calendar in one click, if you'd like to adopt them as new categories of your own. Confirm, and the event lands on your public calendar.

The button on that event in your feed now reads **Reposted**, in green. To unpublish, click the **Reposted** label — see [Unpublish an event](#unpublish-an-event) below.

Publishing by hand is the right pace when you want editorial control over what lands on your calendar. You see a steady stream of incoming events, you decide which ones serve your community, you pick those.

## Let rules publish for you

If the calendar you're connected to posts the kind of events you'd publish almost every time anyway, you can let a rule do it for you. From the **Following** tab, find the connection's row and use the toggles in its right-hand column. There are two, in nesting order:

- **Auto-repost original events.** When the source calendar posts an event of their own, publish it on yours automatically.
- **Also auto-repost shared events.** Only available when the first toggle is on. When the source calendar *itself* publishes an event from another calendar, publish their repost too. This is how an event from a third calendar two hops away can end up on yours; turn it on if you trust the source's editorial taste, off if you only want the events they originate themselves.

Rule-published events show up on your calendar like any other published event, with one small visible difference *in your feed*: the button reads **Auto-posted** in muted gray rather than **Reposted** in green. That's so you can tell at a glance which events you chose by hand and which arrived through a rule. Visitors to your public calendar see the same thing either way.

::: tip <Lightbulb /> A note on auto-repost and category matching.
Rule-driven publishing works best when category matching is set up first. Without matchings, a rule-published event can land on your calendar with no categories — it'll publish, but it won't show up under any of your filters and won't appear under "more like this" on related events. The category-matching guide walks through the rules; if you're enabling auto-repost on a connection you didn't pre-map, take a minute to set the mappings up afterwards.
:::

## Unpublish an event

In the Feed > Events tab, click the **Reposted** or **Auto-posted** label on any event currently on your calendar. The event is removed from your calendar immediately — visitors no longer see it there.

The unpublish *sticks*. If the source calendar later edits and re-broadcasts that same event — a name change, a venue update, a re-share — your calendar does **not** pick it up again. Once you've said no to a particular event, your no is durable; the source can't accidentally undo your decision by republishing.

Two clarifications about the stickiness:

- **It's per-calendar, not per-account.** If you run two calendars and you've unpublished an event on one, the other is unaffected. Each calendar's editorial decisions belong to that calendar alone.
- **It applies to that one event, not to the whole connection.** Unpublishing a single concert doesn't mean you've disconnected from the venue or stopped getting their other events. Future events from the same source still flow through the same way.

If you change your mind, click <Btn>Repost</Btn> on the same event in your feed; that publishes it again, overriding the prior unpublish, and the event is back on your calendar.

## Aggregator vs. curated: a framing decision

Most calendar owners face this choice within their first few weeks of running a calendar. It's a question you'll probably revisit a few times as your calendar grows.

**An aggregator calendar connects broadly and lets rules publish most of what comes in.** The bias is toward inclusion: anyone running events relevant to your community gets surfaced on your calendar, with category-matching rules doing most of the editorial work. The result is a busy calendar that functions as a regional or topical clearinghouse — *the* place to look up "what's happening this weekend in our town" or "all climate-action events in the region this month." A municipality's all-events calendar, a coworking space's tech-meetup roundup, or a regional arts council page tend to be aggregators.

**A curated calendar connects selectively and publishes deliberately, mostly by hand.** The bias is toward editorial fit: a smaller list of events that meet a higher bar, individually picked, sometimes re-introduced or re-framed in description. The result is a calendar that earns visitors' trust through what it leaves *out* as much as what it includes — *the* place to look up "the events the editor of this calendar personally vouches for." A neighborhood association's "what we recommend this week" or a single venue's hand-picked partner-event list tend to be curated.

Two things about this choice:

**It isn't binary.** Auto-repost rules are per-connection. You can be an aggregator for some sources (the city's parks-and-rec calendar, where you trust everything they post) and curated for others (a peer venue, where their events are interesting but you want the final say). Most established calendars end up a mix.

**You can change posture later, but the directions aren't symmetric.** Switching from curated to aggregator is straightforward — flip the toggles on existing connections, set up category matchings, accept the increased throughput. Switching the other way is harder; once visitors associate your calendar with a particular flow, dropping a stream of auto-published events they were used to seeing is a noticeable change. Lean toward starting curated and opening up later, rather than starting open and tightening down.

The right starting posture depends on your calendar's purpose and your editorial bandwidth. A small volunteer group with one editor and a few hours a week probably can't sustain a curated calendar of fifty connected sources; an aggregator posture lets the rules carry the load. A neighborhood newsletter run by a single careful editor probably *should* be curated; visitors come to it for the editor's judgment, and an unfiltered firehose loses that.

::: tip <Lightbulb /> A note on the first month.
Like the category list, your aggregator-vs-curated posture is a draft, not a commitment. Watch what kinds of events actually flow through your connections for a month or two before tuning the toggles. The connections that consistently surface things worth publishing are obvious by then — and the ones that mostly add noise are obvious too.
:::
